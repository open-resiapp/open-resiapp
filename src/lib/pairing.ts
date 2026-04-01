import crypto from "crypto";
import bcrypt from "bcrypt";
import { db } from "@/db";
import { pairingRequests, externalConnections } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { ApiKeyPermission, ConnectionType } from "@/types";
import { validatePartA, validatePartB } from "./input-validation";

const PART_A_PREFIX = "orai_";
const EXPIRY_HOURS = 1;
const BCRYPT_ROUNDS = 12;

export function generatePartA(): string {
  return PART_A_PREFIX + crypto.randomBytes(32).toString("hex");
}

export function getTokenPrefix(token: string): string {
  return token.substring(0, 12);
}

export function deriveApiKey(partA: string, partB: string): string {
  return crypto
    .createHmac("sha256", partA)
    .update(partB)
    .digest("hex");
}

export async function createPairingRequest(params: {
  email: string;
  connectionType: ConnectionType;
  permissions: ApiKeyPermission;
  createdById: string;
  rotationForConnectionId?: string;
}): Promise<{ partA: string; pairingId: string }> {
  const partA = generatePartA();
  const partAHash = await bcrypt.hash(partA, BCRYPT_ROUNDS);
  const partAPrefix = getTokenPrefix(partA);
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

  const [request] = await db
    .insert(pairingRequests)
    .values({
      email: params.email,
      partAHash,
      partAPrefix,
      connectionType: params.connectionType,
      permissions: params.permissions,
      status: "pending",
      expiresAt,
      createdById: params.createdById,
      rotationForConnectionId: params.rotationForConnectionId || null,
    })
    .returning({ id: pairingRequests.id });

  return { partA, pairingId: request.id };
}

const MAX_FAILED_ATTEMPTS = 5;

export async function completePairing(params: {
  partA: string;
  partB: string;
  appName: string;
  ip?: string;
}): Promise<{
  success: boolean;
  error?: string;
  connectionId?: string;
  keyPrefix?: string;
}> {
  // Validate input format before any DB/bcrypt work
  if (!validatePartA(params.partA)) {
    return { success: false, error: "Invalid pairing code format" };
  }
  if (!validatePartB(params.partB)) {
    return { success: false, error: "Invalid key format" };
  }

  const partAPrefix = getTokenPrefix(params.partA);

  // Find matching pairing request (pending or locked) by prefix
  const [request] = await db
    .select()
    .from(pairingRequests)
    .where(
      and(
        eq(pairingRequests.partAPrefix, partAPrefix),
        inArray(pairingRequests.status, ["pending", "locked"])
      )
    )
    .limit(1);

  if (!request) {
    return { success: false, error: "Pairing request not found" };
  }

  // If locked, reject immediately
  if (request.status === "locked") {
    return { success: false, error: "Pairing request is locked due to too many failed attempts" };
  }

  // Check expiry
  if (new Date() > request.expiresAt) {
    await db
      .update(pairingRequests)
      .set({ status: "expired" })
      .where(eq(pairingRequests.id, request.id));
    return { success: false, error: "Pairing code has expired" };
  }

  // Verify Part A hash
  const isValid = await bcrypt.compare(params.partA, request.partAHash);
  if (!isValid) {
    // Increment failed attempts
    const newAttempts = (request.failedAttempts ?? 0) + 1;
    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      await db
        .update(pairingRequests)
        .set({
          failedAttempts: newAttempts,
          status: "locked",
          lockedAt: new Date(),
        })
        .where(eq(pairingRequests.id, request.id));
      return { success: false, error: "Pairing request locked due to too many failed attempts" };
    }
    await db
      .update(pairingRequests)
      .set({ failedAttempts: newAttempts })
      .where(eq(pairingRequests.id, request.id));
    return { success: false, error: "Invalid pairing code" };
  }

  // Derive API key from both parts
  const apiKey = deriveApiKey(params.partA, params.partB);
  const apiKeyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
  const apiKeyPrefix = apiKey.substring(0, 8);

  let connectionId: string;

  if (request.rotationForConnectionId) {
    // Key rotation: update existing connection, keep old key for 24h grace period
    const [existingConn] = await db
      .select()
      .from(externalConnections)
      .where(eq(externalConnections.id, request.rotationForConnectionId))
      .limit(1);

    if (!existingConn) {
      return { success: false, error: "Connection to rotate not found" };
    }

    await db
      .update(externalConnections)
      .set({
        previousApiKeyHash: existingConn.apiKeyHash,
        previousKeyExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h grace
        apiKeyHash,
        apiKeyPrefix,
      })
      .where(eq(externalConnections.id, existingConn.id));

    connectionId = existingConn.id;
  } else {
    // New connection
    const [connection] = await db
      .insert(externalConnections)
      .values({
        name: params.appName,
        type: request.connectionType,
        apiKeyHash,
        apiKeyPrefix,
        permissions: request.permissions,
        isActive: true,
        pairedAt: new Date(),
      })
      .returning({ id: externalConnections.id });

    connectionId = connection.id;
  }

  // Mark pairing request as completed
  await db
    .update(pairingRequests)
    .set({
      status: "completed",
      completedAt: new Date(),
      connectionId,
    })
    .where(eq(pairingRequests.id, request.id));

  return {
    success: true,
    connectionId,
    keyPrefix: apiKeyPrefix,
  };
}
