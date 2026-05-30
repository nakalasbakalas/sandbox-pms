import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  CheckCircle, 
  XCircle, 
  Eye, 
  EyeSlash, 
  Sparkle,
  CircleNotch,
  Info,
  Copy,
  ChatCircle,
} from '@phosphor-icons/react'
import { lineService, lineThrottleService } from '@/lib/line'
import { LineConfig, LineBotInfo, DEFAULT_LINE_TEMPLATES, LineTemplate } from '@/types/line'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

export function LineSettings() {
  const [config, setConfig] = useKV<LineConfig>('line-config', {
    channelId: '',
    channelSecret: '',
    channelAccessToken: '',
    webhookUrl: '',
    webhookEnabled: false,
    testMode: true,
    testRecipientIds: [],
    enabled: false,
    lastTestSuccess: false,
  })

  const [templates, setTemplates] = useKV<LineTemplate[]>('line-templates', DEFAULT_LINE_TEMPLATES)
  const [showSecret, setShowSecret] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [botInfo, setBotInfo] = useState<LineBotInfo | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    if (config?.channelAccessToken) {
      lineService.setConfig(config)
    }
  }, [config])

  const handleTestConnection = async () => {
    if (!config?.channelAccessToken) {
      toast.error('Please enter Channel Access Token')
      return
    }

    setTesting(true)
    setTestError(null)
    setBotInfo(null)

    lineService.setConfig(config)
    const result = await lineService.testConnection()

    setTesting(false)

    if (result.success && result.info) {
      setBotInfo(result.info)
      setConfig((current) => ({
        ...current!,
        lastTestedAt: new Date().toISOString(),
        lastTestSuccess: true,
      }))
      toast.success('LINE connection successful!')
    } else {
      setTestError(result.error || 'Connection failed')
      setConfig((current) => ({
        ...current!,
        lastTestedAt: new Date().toISOString(),
        lastTestSuccess: false,
      }))
      toast.error('LINE connection failed')
    }
  }

  const handleSaveConfig = () => {
    setConfig((current) => ({ ...current! }))
    toast.success('LINE configuration saved')
  }

  const handleCopyWebhookUrl = () => {
    const url = `${window.location.origin}/api/line/webhook`
    navigator.clipboard.writeText(url)
    toast.success('Webhook URL copied to clipboard')
  }

  const handleToggleEnabled = (enabled: boolean) => {
    setConfig((current) => ({ ...current!, enabled }))
    toast.success(enabled ? 'LINE integration enabled' : 'LINE integration disabled')
  }

  const handleToggleTestMode = (testMode: boolean) => {
    setConfig((current) => ({ ...current!, testMode }))
    toast.success(testMode ? 'Test mode enabled' : 'Test mode disabled')
  }

  const handleToggleWebhook = (webhookEnabled: boolean) => {
    setConfig((current) => ({ ...current!, webhookEnabled }))
    toast.success(webhookEnabled ? 'Webhook enabled' : 'Webhook disabled')
  }

  const webhookUrl = `${window.location.origin}/api/line/webhook`

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">LINE Integration</h2>
        <p className="text-sm text-muted-foreground">
          Configure LINE Messaging API for guest and staff communications
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ChatCircle className="text-primary" size={24} />
                Connection Status
              </CardTitle>
              <CardDescription>Test your LINE API credentials</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Enabled</span>
                <Switch
                  checked={config?.enabled ?? false}
                  onCheckedChange={handleToggleEnabled}
                />
              </div>
              {config?.enabled && (
                <Badge variant={config?.lastTestSuccess ? 'default' : 'destructive'}>
                  {config?.lastTestSuccess ? (
                    <>
                      <CheckCircle size={14} className="mr-1" />
                      Connected
                    </>
                  ) : (
                    <>
                      <XCircle size={14} className="mr-1" />
                      {config?.lastTestedAt ? 'Failed' : 'Not Tested'}
                    </>
                  )}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {botInfo && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="text-green-600" size={18} />
              <AlertDescription>
                <strong>Connected to: {botInfo.displayName}</strong>
                <br />
                <span className="text-sm text-muted-foreground">
                  Basic ID: {botInfo.basicId} • User ID: {botInfo.userId.slice(0, 16)}...
                </span>
              </AlertDescription>
            </Alert>
          )}

          {testError && (
            <Alert variant="destructive">
              <XCircle size={18} />
              <AlertDescription>
                <strong>Connection Failed</strong>
                <br />
                <span className="text-sm">{testError}</span>
              </AlertDescription>
            </Alert>
          )}

          {config?.lastTestedAt && (
            <div className="text-xs text-muted-foreground">
              Last tested: {new Date(config.lastTestedAt).toLocaleString()}
            </div>
          )}

          <Button
            onClick={handleTestConnection}
            disabled={testing || !config?.channelAccessToken}
            className="w-full"
          >
            {testing ? (
              <>
                <CircleNotch className="animate-spin mr-2" size={16} />
                Testing Connection...
              </>
            ) : (
              <>
                <Sparkle className="mr-2" size={16} />
                Test Connection
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
          <CardDescription>
            Enter your LINE Official Account credentials from the LINE Developers Console
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-id">Channel ID</Label>
            <Input
              id="channel-id"
              value={config?.channelId ?? ''}
              onChange={(e) => setConfig((current) => ({ ...current!, channelId: e.target.value }))}
              placeholder="1234567890"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-secret">Channel Secret</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="channel-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={config?.channelSecret ?? ''}
                  onChange={(e) =>
                    setConfig((current) => ({ ...current!, channelSecret: e.target.value }))
                  }
                  placeholder="Enter your channel secret"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeSlash size={18} /> : <Eye size={18} />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="access-token">Channel Access Token (Long-lived)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="access-token"
                  type={showToken ? 'text' : 'password'}
                  value={config?.channelAccessToken ?? ''}
                  onChange={(e) =>
                    setConfig((current) => ({ ...current!, channelAccessToken: e.target.value }))
                  }
                  placeholder="Enter your channel access token"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeSlash size={18} /> : <Eye size={18} />}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyWebhookUrl}
              >
                <Copy size={18} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure this URL in your LINE Developers Console under Webhook Settings
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Webhook</Label>
              <p className="text-xs text-muted-foreground">
                Receive incoming messages from guests
              </p>
            </div>
            <Switch
              checked={config?.webhookEnabled ?? false}
              onCheckedChange={handleToggleWebhook}
            />
          </div>

          <Separator />

          <Alert>
            <Info size={18} />
            <AlertDescription>
              <strong>Test Mode</strong>
              <br />
              When enabled, guest messages will only be sent to test recipients to prevent accidental messaging.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Test Mode</Label>
              <p className="text-xs text-muted-foreground">
                Block guest messages in development
              </p>
            </div>
            <Switch
              checked={config?.testMode ?? true}
              onCheckedChange={handleToggleTestMode}
            />
          </div>

          {config?.testMode && (
            <div className="space-y-2">
              <Label htmlFor="test-recipients">Test Recipient LINE IDs (comma-separated)</Label>
              <Input
                id="test-recipients"
                value={config?.testRecipientIds?.join(', ') ?? ''}
                onChange={(e) =>
                  setConfig((current) => ({
                    ...current!,
                    testRecipientIds: e.target.value
                      .split(',')
                      .map((id) => id.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="U1234567890abcdef, U0987654321fedcba"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Messages will only be sent to these LINE user IDs when test mode is enabled
              </p>
            </div>
          )}

          <Button onClick={handleSaveConfig} className="w-full">
            Save Configuration
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message Templates</CardTitle>
          <CardDescription>
            Manage LINE message templates for guest and staff communications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="guest" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="guest">Guest Templates</TabsTrigger>
              <TabsTrigger value="staff">Staff Alerts</TabsTrigger>
            </TabsList>
            
            <TabsContent value="guest" className="space-y-3 mt-4">
              <ScrollArea className="h-[400px] pr-4">
                {(templates ?? [])
                  .filter((t) => t.category === 'guest')
                  .map((template) => (
                    <Card key={template.id} className="mb-3">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {template.description}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={template.trigger === 'automated' ? 'default' : 'secondary'}>
                              {template.trigger}
                            </Badge>
                            <Switch
                              checked={template.enabled}
                              onCheckedChange={(enabled) => {
                                setTemplates((current) =>
                                  (current || []).map((t) =>
                                    t.id === template.id ? { ...t, enabled } : t
                                  )
                                )
                                toast.success(
                                  enabled
                                    ? `${template.name} enabled`
                                    : `${template.name} disabled`
                                )
                              }}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-muted rounded-md p-3">
                          <pre className="text-xs whitespace-pre-wrap font-mono">
                            {template.contentTemplate}
                          </pre>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-3">
                          {template.variables.map((v) => (
                            <Badge key={v.key} variant="outline" className="text-xs">
                              {`{{${v.key}}}`}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="staff" className="space-y-3 mt-4">
              <ScrollArea className="h-[400px] pr-4">
                {(templates ?? [])
                  .filter((t) => t.category === 'staff')
                  .map((template) => (
                    <Card key={template.id} className="mb-3">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {template.description}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={template.trigger === 'automated' ? 'default' : 'secondary'}>
                              {template.trigger}
                            </Badge>
                            <Switch
                              checked={template.enabled}
                              onCheckedChange={(enabled) => {
                                setTemplates((current) =>
                                  (current || []).map((t) =>
                                    t.id === template.id ? { ...t, enabled } : t
                                  )
                                )
                                toast.success(
                                  enabled
                                    ? `${template.name} enabled`
                                    : `${template.name} disabled`
                                )
                              }}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-muted rounded-md p-3">
                          <pre className="text-xs whitespace-pre-wrap font-mono">
                            {template.contentTemplate}
                          </pre>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-3">
                          {template.variables.map((v) => (
                            <Badge key={v.key} variant="outline" className="text-xs">
                              {`{{${v.key}}}`}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup Instructions</CardTitle>
          <CardDescription>How to get your LINE credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                1
              </div>
              <div>
                <p className="text-sm font-medium">Create a LINE Official Account</p>
                <p className="text-xs text-muted-foreground">
                  Visit{' '}
                  <a
                    href="https://developers.line.biz/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    LINE Developers Console
                  </a>{' '}
                  and create a new provider and channel
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                2
              </div>
              <div>
                <p className="text-sm font-medium">Get Channel Credentials</p>
                <p className="text-xs text-muted-foreground">
                  Navigate to your channel's Basic Settings to find Channel ID and Channel Secret
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                3
              </div>
              <div>
                <p className="text-sm font-medium">Issue Channel Access Token</p>
                <p className="text-xs text-muted-foreground">
                  Go to Messaging API tab and issue a long-lived Channel Access Token
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                4
              </div>
              <div>
                <p className="text-sm font-medium">Configure Webhook (Optional)</p>
                <p className="text-xs text-muted-foreground">
                  Copy the webhook URL above and paste it in the Webhook Settings section
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                5
              </div>
              <div>
                <p className="text-sm font-medium">Test the Connection</p>
                <p className="text-xs text-muted-foreground">
                  Click "Test Connection" above to verify your credentials are working
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
