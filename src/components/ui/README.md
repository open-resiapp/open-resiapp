# UI kit (`@/components/ui`)

Import from the barrel: `import { Button, Modal } from "@/components/ui"`.
All text comes from props (use `useTranslations` at the call site). Only fallbacks live in the
`Ui` namespace (`close`, `cancel`, `moreActions`, `loading`). Senior baseline: 44px tap targets,
`text-base`, contrast >= 4.5:1, one primary button per screen.

| Component | Props | Usage |
|---|---|---|
| `Button` | `variant: primary\|secondary\|danger\|ghost`, `size: md\|lg`, `loading`, `fullWidth`, + button props | `<Button loading={busy} onClick={save}>{t("save")}</Button>` |
| `ButtonLink` | same styling + next-intl `Link` props (`href`) | `<ButtonLink href="/voting/new">{t("new")}</ButtonLink>` |
| `Card` | `padding: none\|sm\|md\|lg`, `interactive`, `as: div\|section\|article\|aside\|li` | `<Card as="section" interactive>…</Card>` |
| `Modal` | `open`, `onClose`, `title`, `children`, `footer`, `closeLabel?`, `closeOnBackdrop?` | `<Modal open={o} onClose={close} title={t("x")} footer={<Button>…</Button>}>…</Modal>` |
| `ConfirmDialog` | `open`, `title`, `description` (state the consequence), `confirmLabel`, `cancelLabel?`, `tone: danger\|default`, `loading`, `onConfirm`, `onCancel` | `<ConfirmDialog open tone="danger" description={t("deleteWarn")} … />` |
| `ConfirmProvider` / `useConfirm()` | `confirm({title, description, confirmLabel, cancelLabel?, tone?}) => Promise<boolean>` | mount `<ConfirmProvider>` once; `if (await confirm({...})) remove()` replaces `window.confirm` |
| `Field` | `label`, `htmlFor?`, `hint?`, `error?`, `required?` | `<Field label={t("name")} error={err}><Input value=… /></Field>` (wires id, aria-describedby, aria-invalid) |
| `Input` / `Select` / `Textarea` | native props + `invalid?` | `<Select>{options}</Select>` |
| `PageHeader` | `title`, `description?`, `backHref?`, `backLabel?`, `actions?` | `<PageHeader title={t("t")} actions={<ButtonLink …/>} />` |
| `EmptyState` | `icon?` (IconName or node), `title`, `description?`, `action?` | `<EmptyState icon="file" title={t("none")} action={<Button>…</Button>} />` |
| `Tabs` | `items: {value,label,href?,badge?}[]`, `value`, `onChange?`, `aria-label?` | `<Tabs items={items} value={tab} onChange={setTab} aria-label={t("tabs")} />` |
| `Badge` | `tone: neutral\|success\|warning\|danger\|info` | `<Badge tone="warning">{t("pending")}</Badge>` |
| `ActionMenu` | `items: {label,onSelect,tone?,disabled?}[]`, `label?`, `align?` | `<ActionMenu label={t("actionsFor",{n})} items={[…]} />` |
| `Spinner` / `LoadingBlock` | `size?` / `label?` | `<LoadingBlock />` |
| `Icon` | `name: IconName`, `size?` (24), `title?` (else aria-hidden) | `<Icon name="home" />` |

`IconName`: home megaphone vote wallet building users file settings user logout plus chevronRight
chevronLeft chevronDown check x alert info calendar bell menu more upload download search phone
mail edit trash clock qr key link help heart. Icons are decorative: always add a visible text label.

## Tokens (`src/app/globals.css`, block "UI KIT SEMANTIC TOKENS")

CSS vars (light on `:root`, dark on `html.dark`): `--ui-bg --ui-surface --ui-surface-muted
--ui-border --ui-border-strong --ui-text --ui-text-muted --ui-primary --ui-primary-text
--ui-danger --ui-danger-text --ui-success --ui-warning --ui-info --ui-focus --ui-overlay`.
Tailwind classes: `bg-ui-*`, `text-ui-*`, `border-ui-*`, `ring-ui-focus` (e.g. `bg-ui-primary`,
`text-ui-text-muted`, `border-ui-border-strong`). New code should use these, not `blue-*`/`gray-*`
(the legacy blue->gray remap stays for old pages).
