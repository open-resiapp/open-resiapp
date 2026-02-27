/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["next-auth", "@auth/core"],
};

export default nextConfig;
