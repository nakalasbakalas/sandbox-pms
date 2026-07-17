import { useCallback, useEffect, useMemo, useState } from 'react'
import { Buildings, Gear, Receipt, ShieldCheck, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import {
  settingsApi,
  type ServerPropertyProfile,
  type ServerPropertyPolicies,
  type ServerPropertySettings,
  type ServerAccountingSettings,
  type ServerOperationsSettings,
  type ServerPaymentMethod,
  type ServerPaymentSettings,
  type ServerSettingsStatus,
  type ServerTaxItem,
} from '@/lib/settings-api-client'
import type { MoneySatang } from '@/types/money'
import { RoomTypeManagement } from '@/components/settings/RoomTypeManagement'

type PropertyForm = ServerPropertyProfile & {
  extraGuestFeeSatang: string
  childFeeSatang: string
  inventoryMinimumRateSatang: string
}

const EMPTY_PROFILE: PropertyForm = {
  name: '',
  address: '',
  phone: '',
  email: '',
  publicWebsite: '',
  lineId: '',
  lineUrl: '',
  supportHours: '',
  reservationAlertEmail: '',
  timezone: 'Asia/Bangkok',
  defaultCheckIn: '14:00',
  defaultCheckOut: '11:00',
  currency: 'THB',
  extraGuestFeeSatang: '0',
  childFeeSatang: '0',
  inventoryMinimumRateSatang: '',
}

const EMPTY_POLICIES: ServerPropertyPolicies = {
  checkInWindow: '', checkOutWindow: '', smoking: '', cancellation: '', deposit: '', noShow: '', childPolicy: '',
}

const EMPTY_OPERATIONS: ServerOperationsSettings = {
  alertRecipients: [],
}

const EMPTY_ACCOUNTING: ServerAccountingSettings = {}

const EMPTY_PAYMENT_METHODS: ServerPaymentSettings = {
  paymentGatewayConfigured: false, enabledMethods: [],
}

const PAYMENT_METHODS: Array<{ value: ServerPaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'PROMPTPAY', label: 'PromptPay' },
  { value: 'CARD_RECORDED_ONLY', label: 'Card recorded only (no gateway charge)' },
]

function toPropertyForm(settings: ServerPropertySettings): PropertyForm {
  return {
    ...EMPTY_PROFILE,
    ...settings.profile,
    address: settings.profile.address ?? '',
    phone: settings.profile.phone ?? '',
    email: settings.profile.email ?? '',
    publicWebsite: settings.profile.publicWebsite ?? '',
    lineId: settings.profile.lineId ?? '',
    lineUrl: settings.profile.lineUrl ?? '',
    supportHours: settings.profile.supportHours ?? '',
    reservationAlertEmail: settings.profile.reservationAlertEmail ?? '',
    extraGuestFeeSatang: settings.fees.extraGuestFeeSatang,
    childFeeSatang: settings.fees.childFeeSatang,
    inventoryMinimumRateSatang: settings.fees.inventoryMinimumRateSatang ?? '',
  }
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

function statusTone(value: string) {
  return value === 'configured' ? 'default' : 'secondary'
}

export function ServerSettingsView() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('edit:settings')
  const [settings, setSettings] = useState<ServerPropertySettings | null>(null)
  const [status, setStatus] = useState<ServerSettingsStatus | null>(null)
  const [propertyForm, setPropertyForm] = useState<PropertyForm>(EMPTY_PROFILE)
  const [taxes, setTaxes] = useState<ServerTaxItem[]>([])
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false)
  const [policies, setPolicies] = useState<ServerPropertyPolicies>(EMPTY_POLICIES)
  const [operations, setOperations] = useState<ServerOperationsSettings>(EMPTY_OPERATIONS)
  const [accounting, setAccounting] = useState<ServerAccountingSettings>(EMPTY_ACCOUNTING)
  const [paymentMethods, setPaymentMethods] = useState<ServerPaymentSettings>(EMPTY_PAYMENT_METHODS)
  const [alertRecipientsText, setAlertRecipientsText] = useState('')
  const [propertyReason, setPropertyReason] = useState('')
  const [taxReason, setTaxReason] = useState('')
  const [configurationReason, setConfigurationReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<'property' | 'tax' | 'configuration' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        settingsApi.getProperty(),
        settingsApi.getStatus(),
      ])
      setSettings(nextSettings)
      setStatus(nextStatus)
      setPropertyForm(toPropertyForm(nextSettings))
      setTaxes(nextSettings.taxConfiguration.taxes)
      setTaxEnabled(nextSettings.taxConfiguration.enabled)
      setPricesIncludeTax(nextSettings.taxConfiguration.pricesIncludeTax)
      setPolicies({ ...EMPTY_POLICIES, ...nextSettings.policies })
      setOperations({ ...EMPTY_OPERATIONS, ...nextSettings.operationalSettings.operations })
      setAccounting({ ...EMPTY_ACCOUNTING, ...nextSettings.operationalSettings.accounting })
      setPaymentMethods({ ...EMPTY_PAYMENT_METHODS, ...nextSettings.operationalSettings.paymentMethods })
      setAlertRecipientsText((nextSettings.operationalSettings.operations.alertRecipients || []).join('\n'))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Server settings could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const totalBasisPoints = useMemo(
    () => taxes.reduce((sum, tax) => sum + (Number.isInteger(tax.rateBasisPoints) ? tax.rateBasisPoints : 0), 0),
    [taxes],
  )

  const validateReason = (reason: string) => {
    if (reason.trim().length >= 3) return true
    setError('Enter an operational reason of at least 3 characters before saving.')
    return false
  }

  const validateSatang = (...values: string[]) => {
    if (values.every((value) => value === '' || /^\d+$/.test(value))) return true
    setError('Fee amounts must be non-negative base-10 satang integers (for example, 15000 means ฿150.00).')
    return false
  }

  const restoreConfirmedForms = () => {
    if (!settings) return
    setPropertyForm(toPropertyForm(settings))
    setTaxes(settings.taxConfiguration.taxes)
    setTaxEnabled(settings.taxConfiguration.enabled)
    setPricesIncludeTax(settings.taxConfiguration.pricesIncludeTax)
    setPolicies({ ...EMPTY_POLICIES, ...settings.policies })
    setOperations({ ...EMPTY_OPERATIONS, ...settings.operationalSettings.operations })
    setAccounting({ ...EMPTY_ACCOUNTING, ...settings.operationalSettings.accounting })
    setPaymentMethods({ ...EMPTY_PAYMENT_METHODS, ...settings.operationalSettings.paymentMethods })
    setAlertRecipientsText((settings.operationalSettings.operations.alertRecipients || []).join('\n'))
  }

  const saveProperty = async () => {
    if (!canEdit || !validateReason(propertyReason)) return
    if (!validateSatang(
      propertyForm.extraGuestFeeSatang,
      propertyForm.childFeeSatang,
      propertyForm.inventoryMinimumRateSatang,
    )) return
    setSaving('property')
    setError(null)
    try {
      await settingsApi.updateProperty({
        reason: propertyReason.trim(),
        profile: {
          name: propertyForm.name.trim(),
          address: nullable(propertyForm.address ?? ''),
          phone: nullable(propertyForm.phone ?? ''),
          email: nullable(propertyForm.email ?? ''),
          publicWebsite: nullable(propertyForm.publicWebsite ?? ''),
          lineId: nullable(propertyForm.lineId ?? ''),
          lineUrl: nullable(propertyForm.lineUrl ?? ''),
          supportHours: nullable(propertyForm.supportHours ?? ''),
          reservationAlertEmail: nullable(propertyForm.reservationAlertEmail ?? ''),
          timezone: propertyForm.timezone,
          defaultCheckIn: propertyForm.defaultCheckIn,
          defaultCheckOut: propertyForm.defaultCheckOut,
          currency: propertyForm.currency,
        },
        fees: {
          extraGuestFeeSatang: propertyForm.extraGuestFeeSatang as MoneySatang,
          childFeeSatang: propertyForm.childFeeSatang as MoneySatang,
          inventoryMinimumRateSatang: propertyForm.inventoryMinimumRateSatang
            ? propertyForm.inventoryMinimumRateSatang as MoneySatang
            : null,
        },
      })
      setPropertyReason('')
      await load()
      toast.success('Property settings saved and confirmed by the server.')
    } catch (saveError) {
      restoreConfirmedForms()
      setError(saveError instanceof Error ? saveError.message : 'Property settings were not saved.')
    } finally {
      setSaving(null)
    }
  }

  const saveTax = async () => {
    if (!canEdit || !validateReason(taxReason)) return
    setSaving('tax')
    setError(null)
    try {
      await settingsApi.updateTax({
        reason: taxReason.trim(),
        enabled: taxEnabled,
        pricesIncludeTax,
        taxes,
      })
      setTaxReason('')
      await load()
      toast.success('Tax settings saved and confirmed by the server.')
    } catch (saveError) {
      restoreConfirmedForms()
      setError(saveError instanceof Error ? saveError.message : 'Tax settings were not saved.')
    } finally {
      setSaving(null)
    }
  }

  const saveConfiguration = async (section: 'policies' | 'operations') => {
    if (!canEdit || !validateReason(configurationReason)) return
    const alertRecipients = [...new Set(alertRecipientsText.split(/[\n,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))]
    setSaving('configuration')
    setError(null)
    try {
      await settingsApi.updateProperty({
        reason: configurationReason.trim(),
        ...(section === 'policies' ? {
          policies: Object.fromEntries(Object.entries(policies).map(([key, value]) => [key, typeof value === 'string' ? nullable(value) : value])) as ServerPropertyPolicies,
        } : {
          operationalSettings: {
            operations: { ...operations, alertRecipients },
            accounting,
            paymentMethods: { paymentGatewayConfigured: false, enabledMethods: paymentMethods.enabledMethods || [] },
          },
        }),
      })
      setConfigurationReason('')
      await load()
      toast.success('Operational settings saved and confirmed by the server.')
    } catch (saveError) {
      restoreConfirmedForms()
      setError(saveError instanceof Error ? saveError.message : 'Operational settings were not saved.')
    } finally {
      setSaving(null)
    }
  }

  if (loading && !settings) {
    return <div className="p-8 text-sm text-muted-foreground">Loading authoritative property settings…</div>
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Gear weight="duotone" size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{settings?.profile.name || 'Property'} Settings</h1>
              <p className="text-sm text-muted-foreground">Server-authoritative property and financial configuration</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 p-6">
        {error && (
          <Alert variant="destructive">
            <Warning size={18} />
            <AlertTitle>Settings not confirmed</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
            </AlertDescription>
          </Alert>
        )}
        {!canEdit && (
          <Alert>
            <ShieldCheck size={18} />
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>Your role can inspect settings but cannot change them.</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="property">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="property">Property</TabsTrigger>
            <TabsTrigger value="policies">Policies</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="tax">Tax</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
          </TabsList>

          <TabsContent value="property" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Buildings size={20} /> Property profile</CardTitle>
                <CardDescription>Values shown here come from the active property in PostgreSQL.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Property name" value={propertyForm.name} onChange={(name) => setPropertyForm((form) => ({ ...form, name }))} />
                  <Field label="Email" type="email" value={propertyForm.email ?? ''} onChange={(email) => setPropertyForm((form) => ({ ...form, email }))} />
                  <Field label="Phone" value={propertyForm.phone ?? ''} onChange={(phone) => setPropertyForm((form) => ({ ...form, phone }))} />
                  <Field label="Public HTTPS website" value={propertyForm.publicWebsite ?? ''} onChange={(publicWebsite) => setPropertyForm((form) => ({ ...form, publicWebsite }))} />
                  <Field label="LINE public ID" value={propertyForm.lineId ?? ''} onChange={(lineId) => setPropertyForm((form) => ({ ...form, lineId }))} />
                  <Field label="LINE public HTTPS URL" value={propertyForm.lineUrl ?? ''} onChange={(lineUrl) => setPropertyForm((form) => ({ ...form, lineUrl }))} />
                  <Field label="Support hours" value={propertyForm.supportHours ?? ''} onChange={(supportHours) => setPropertyForm((form) => ({ ...form, supportHours }))} />
                  <Field label="Reservation alert email" type="email" value={propertyForm.reservationAlertEmail ?? ''} onChange={(reservationAlertEmail) => setPropertyForm((form) => ({ ...form, reservationAlertEmail }))} />
                  <Field label="Address" value={propertyForm.address ?? ''} onChange={(address) => setPropertyForm((form) => ({ ...form, address }))} />
                  <Field label="IANA timezone" value={propertyForm.timezone} onChange={(timezone) => setPropertyForm((form) => ({ ...form, timezone }))} />
                  <Field label="Default check-in" type="time" value={propertyForm.defaultCheckIn} onChange={(defaultCheckIn) => setPropertyForm((form) => ({ ...form, defaultCheckIn }))} />
                  <Field label="Default check-out" type="time" value={propertyForm.defaultCheckOut} onChange={(defaultCheckOut) => setPropertyForm((form) => ({ ...form, defaultCheckOut }))} />
                  <Field label="ISO currency" value={propertyForm.currency} onChange={(currency) => setPropertyForm((form) => ({ ...form, currency: currency.toUpperCase() }))} />
                </div>

                <div className="border-t pt-5">
                  <h3 className="mb-1 font-semibold">Exact fee amounts</h3>
                  <p className="mb-4 text-sm text-muted-foreground">Enter integer satang strings. Example: 15000 is ฿150.00.</p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Extra guest fee (satang)" inputMode="numeric" value={propertyForm.extraGuestFeeSatang} onChange={(extraGuestFeeSatang) => setPropertyForm((form) => ({ ...form, extraGuestFeeSatang }))} />
                    <Field label="Child fee (satang)" inputMode="numeric" value={propertyForm.childFeeSatang} onChange={(childFeeSatang) => setPropertyForm((form) => ({ ...form, childFeeSatang }))} />
                    <Field label="Minimum rate (satang, optional)" inputMode="numeric" value={propertyForm.inventoryMinimumRateSatang} onChange={(inventoryMinimumRateSatang) => setPropertyForm((form) => ({ ...form, inventoryMinimumRateSatang }))} />
                  </div>
                </div>

                <ReasonField value={propertyReason} onChange={setPropertyReason} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => settings && setPropertyForm(toPropertyForm(settings))} disabled={saving !== null}>Discard</Button>
                  <Button onClick={() => void saveProperty()} disabled={!canEdit || saving !== null}>
                    {saving === 'property' ? 'Saving…' : 'Save and verify'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Guest and stay policies</CardTitle>
                <CardDescription>Public-facing policy text persisted for the active property.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Check-in window" value={policies.checkInWindow ?? ''} onChange={(checkInWindow) => setPolicies((value) => ({ ...value, checkInWindow }))} />
                  <Field label="Check-out window" value={policies.checkOutWindow ?? ''} onChange={(checkOutWindow) => setPolicies((value) => ({ ...value, checkOutWindow }))} />
                </div>
                <PolicyField label="Smoking policy" value={policies.smoking ?? ''} onChange={(smoking) => setPolicies((value) => ({ ...value, smoking }))} />
                <PolicyField label="Cancellation policy" value={policies.cancellation ?? ''} onChange={(cancellation) => setPolicies((value) => ({ ...value, cancellation }))} />
                <PolicyField label="Deposit policy" value={policies.deposit ?? ''} onChange={(deposit) => setPolicies((value) => ({ ...value, deposit }))} />
                <PolicyField label="No-show policy" value={policies.noShow ?? ''} onChange={(noShow) => setPolicies((value) => ({ ...value, noShow }))} />
                <PolicyField label="Child policy" value={policies.childPolicy ?? ''} onChange={(childPolicy) => setPolicies((value) => ({ ...value, childPolicy }))} />
                <ConfigurationActions
                  reason={configurationReason}
                  setReason={setConfigurationReason}
                  saving={saving}
                  canEdit={canEdit}
                  onDiscard={restoreConfirmedForms}
                  onSave={() => void saveConfiguration('policies')}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Operational defaults</CardTitle>
                <CardDescription>Daily operations, accounting-export readiness, and accepted recorded payment methods.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Base language" value={operations.baseLanguage || ''} onChange={(baseLanguage) => setOperations((value) => ({ ...value, baseLanguage }))} />
                  <Field label="Business-date cutoff" type="time" value={operations.businessDateCutoffTime || ''} onChange={(businessDateCutoffTime) => setOperations((value) => ({ ...value, businessDateCutoffTime }))} />
                </div>
                <ToggleRow label="Prevent overbooking" checked={operations.noOverbooking === true} onCheckedChange={(noOverbooking) => setOperations((value) => ({ ...value, noOverbooking }))} />
                <div className="space-y-2">
                  <Label>Operational alert recipients</Label>
                  <Textarea value={alertRecipientsText} onChange={(event) => setAlertRecipientsText(event.target.value)} placeholder="one@example.com&#10;two@example.com" rows={4} />
                  <p className="text-xs text-muted-foreground">One email per line, or separate addresses with commas.</p>
                </div>

                <div className="border-t pt-5">
                  <h3 className="mb-3 font-semibold">Accounting export evidence</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Export date format</Label>
                      <Select value={accounting.exportDateFormat || 'YYYY-MM-DD'} onValueChange={(exportDateFormat: NonNullable<ServerAccountingSettings['exportDateFormat']>) => setAccounting((value) => ({ ...value, exportDateFormat }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                          <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                          <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <ToggleRow label="Tax identifiers configured" checked={accounting.taxIdentifiersConfigured === true} onCheckedChange={(taxIdentifiersConfigured) => setAccounting((value) => ({ ...value, taxIdentifiersConfigured }))} />
                      <ToggleRow label="Accounting mappings configured" checked={accounting.accountingMappingsConfigured === true} onCheckedChange={(accountingMappingsConfigured) => setAccounting((value) => ({ ...value, accountingMappingsConfigured }))} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-5">
                  <h3 className="mb-1 font-semibold">Enabled payment methods</h3>
                  <p className="mb-3 text-sm text-muted-foreground">These methods record payments in the PMS. No online gateway is configured.</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {PAYMENT_METHODS.map((method) => (
                      <ToggleRow
                        key={method.value}
                        label={method.label}
                        checked={(paymentMethods.enabledMethods || []).includes(method.value)}
                        onCheckedChange={(checked) => setPaymentMethods((value) => ({
                          ...value,
                          enabledMethods: checked
                            ? [...new Set([...(value.enabledMethods || []), method.value])]
                            : (value.enabledMethods || []).filter((candidate) => candidate !== method.value),
                        }))}
                      />
                    ))}
                  </div>
                </div>

                <ConfigurationActions
                  reason={configurationReason}
                  setReason={setConfigurationReason}
                  saving={saving}
                  canEdit={canEdit}
                  onDiscard={restoreConfirmedForms}
                  onSave={() => void saveConfiguration('operations')}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tax" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Receipt size={20} /> Tax configuration</CardTitle>
                <CardDescription>Rates are stored as integer basis points. 700 basis points equals 7.00%.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <ToggleRow label="Enable tax calculation" checked={taxEnabled} onCheckedChange={setTaxEnabled} />
                <ToggleRow label="Displayed prices include tax" checked={pricesIncludeTax} onCheckedChange={setPricesIncludeTax} />
                <div className="space-y-3">
                  {taxes.map((tax, index) => (
                    <div key={tax.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_180px_180px_auto]">
                      <Field label="Tax name" value={tax.name} onChange={(name) => setTaxes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item))} />
                      <Field label="Rate (basis points)" type="number" value={String(tax.rateBasisPoints)} onChange={(value) => setTaxes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, rateBasisPoints: Number(value) } : item))} />
                      <div className="space-y-2">
                        <Label>Applies to</Label>
                        <Select value={tax.appliesTo} onValueChange={(appliesTo: ServerTaxItem['appliesTo']) => setTaxes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, appliesTo } : item))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All charges</SelectItem>
                            <SelectItem value="ROOM">Room</SelectItem>
                            <SelectItem value="FOOD">Food</SelectItem>
                            <SelectItem value="BEVERAGE">Beverage</SelectItem>
                            <SelectItem value="EXTRAS">Extras</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button className="self-end" variant="outline" onClick={() => setTaxes((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={() => setTaxes((items) => [...items, { id: `tax-${Date.now()}`, name: 'Tax', rateBasisPoints: 0, appliesTo: 'ALL', included: false }])}>Add tax</Button>
                    <span className="text-sm text-muted-foreground">Combined: {(totalBasisPoints / 100).toFixed(2)}%</span>
                  </div>
                </div>
                <ReasonField value={taxReason} onChange={setTaxReason} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => {
                    if (!settings) return
                    setTaxes(settings.taxConfiguration.taxes)
                    setTaxEnabled(settings.taxConfiguration.enabled)
                    setPricesIncludeTax(settings.taxConfiguration.pricesIncludeTax)
                  }} disabled={saving !== null}>Discard</Button>
                  <Button onClick={() => void saveTax()} disabled={!canEdit || saving !== null}>
                    {saving === 'tax' ? 'Saving…' : 'Save and verify'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rooms" className="space-y-4">
            <RoomTypeManagement />
          </TabsContent>

          <TabsContent value="status">
            <Card>
              <CardHeader>
                <CardTitle>Configuration evidence</CardTitle>
                <CardDescription>Reported by the backend for the active property, not inferred from browser storage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(status?.configuration ?? {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                      <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <Badge variant={statusTone(value)}>{value}</Badge>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Source: {status?.sourceOfTruth ?? 'unavailable'} · Generated {status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : 'not available'}
                </p>
                <Button variant="outline" onClick={() => void load()} disabled={loading}>Refresh evidence</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="providers">
            <Card>
              <CardHeader>
                <CardTitle>Provider-pending capabilities</CardTitle>
                <CardDescription>Only capabilities without authoritative backend write APIs are listed here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <PendingCapability title="Branding asset upload" detail="Logo and asset storage require a private, server-managed upload service. Public profile text is editable under Property." />
                <PendingCapability title="LINE provider secrets" detail="LINE tokens and webhook secrets remain backend-only. The public LINE ID and URL are editable under Property." />
                <PendingCapability title="Backup restore" detail="Export or restore cannot be treated as operational until a server-managed backup and recovery workflow is available." />
                <PendingCapability title="Provider delivery" detail="OTA and guest-message delivery remain review-gated or provider-pending; this settings page does not simulate delivery." />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function PolicyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    </div>
  )
}

function ConfigurationActions({ reason, setReason, saving, canEdit, onDiscard, onSave }: {
  reason: string
  setReason: (value: string) => void
  saving: 'property' | 'tax' | 'configuration' | null
  canEdit: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <>
      <ReasonField value={reason} onChange={setReason} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDiscard} disabled={saving !== null}>Discard</Button>
        <Button onClick={onSave} disabled={!canEdit || saving !== null}>
          {saving === 'configuration' ? 'Saving…' : 'Save and verify'}
        </Button>
      </div>
    </>
  )
}

function PendingCapability({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <Badge variant="secondary">Provider pending</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function Field({ label, onChange, ...inputProps }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  inputMode?: 'numeric'
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input {...inputProps} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function ToggleRow({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2 border-t pt-5">
      <Label>Operational reason *</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Why is this configuration changing?" maxLength={1_000} />
      <p className="text-xs text-muted-foreground">Required for the audit trail. Credentials and secret values are rejected by the server.</p>
    </div>
  )
}
