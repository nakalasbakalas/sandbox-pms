import {
  LineConfig,
  LineTemplate,
  LineBotInfo,
  LineWebhookEvent,
} from '@/types/line'

const LINE_API_BASE = 'https://api.line.me/v2/bot'

export class LineService {
  private config: LineConfig | null = null

  setConfig(config: LineConfig) {
    this.config = config
  }

  async testConnection(): Promise<{ success: boolean; info?: LineBotInfo; error?: string }> {
    if (!this.config?.channelAccessToken) {
      return { success: false, error: 'No access token configured' }
    }

    try {
      const response = await fetch(`${LINE_API_BASE}/info`, {
        headers: {
          Authorization: `Bearer ${this.config.channelAccessToken}`,
        },
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, error: `API Error: ${response.status} - ${error}` }
      }

      const info: LineBotInfo = await response.json()
      return { success: true, info }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async sendMessage(
    lineUserId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.config?.channelAccessToken) {
      return { success: false, error: 'LINE not configured' }
    }

    if (!this.config.enabled) {
      return { success: false, error: 'LINE integration is disabled' }
    }

    if (this.config.testMode && !this.config.testRecipientIds.includes(lineUserId)) {
      console.log('[LINE TEST MODE] Message blocked:', { lineUserId, content, metadata })
      return { success: false, error: 'Test mode: message not sent to non-test recipient' }
    }

    try {
      const response = await fetch(`${LINE_API_BASE}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.channelAccessToken}`,
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [
            {
              type: 'text',
              text: content,
            },
          ],
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, error: `API Error: ${response.status} - ${error}` }
      }

      const result = await response.json()
      return { success: true, messageId: result.sentMessages?.[0]?.id }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async sendFlexMessage(
    lineUserId: string,
    altText: string,
    flexContent: any,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.config?.channelAccessToken) {
      return { success: false, error: 'LINE not configured' }
    }

    if (!this.config.enabled) {
      return { success: false, error: 'LINE integration is disabled' }
    }

    if (this.config.testMode && !this.config.testRecipientIds.includes(lineUserId)) {
      console.log('[LINE TEST MODE] Flex message blocked:', { lineUserId, altText, metadata })
      return { success: false, error: 'Test mode: message not sent to non-test recipient' }
    }

    try {
      const response = await fetch(`${LINE_API_BASE}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.channelAccessToken}`,
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [
            {
              type: 'flex',
              altText,
              contents: flexContent,
            },
          ],
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, error: `API Error: ${response.status} - ${error}` }
      }

      const result = await response.json()
      return { success: true, messageId: result.sentMessages?.[0]?.id }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async validateWebhookSignature(signatureHeader: string, body: string): Promise<boolean> {
    if (!this.config?.channelSecret) {
      return false
    }

    try {
      const encoder = new TextEncoder()
      const keyData = encoder.encode(this.config.channelSecret)
      const messageData = encoder.encode(body)

      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData)
      const hash = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))

      return hash === signatureHeader
    } catch (error) {
      console.error('[LINE] Signature validation error:', error)
      return false
    }
  }

  async handleWebhookEvent(event: LineWebhookEvent): Promise<void> {
    console.log('[LINE Webhook Event]', event)

    switch (event.type) {
      case 'message':
        await this.handleIncomingMessage(event)
        break
      case 'follow':
        await this.handleFollowEvent(event)
        break
      case 'unfollow':
        await this.handleUnfollowEvent(event)
        break
      default:
        console.log('[LINE] Unhandled event type:', event.type)
    }
  }

  private async handleIncomingMessage(event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId
    const messageText = event.message?.text

    console.log('[LINE] Incoming message:', { userId, messageText })
  }

  private async handleFollowEvent(event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId
    console.log('[LINE] User followed bot:', userId)
  }

  private async handleUnfollowEvent(event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId
    console.log('[LINE] User unfollowed bot:', userId)
  }
}

export class LineTemplateRenderer {
  render(template: LineTemplate, variables: Record<string, any>): string {
    let content = template.contentTemplate

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{${key}}}`, 'g')
      content = content.replace(placeholder, this.formatValue(value, key, template))
    }

    return content
  }

  renderFlex(template: LineTemplate, variables: Record<string, any>): any {
    let flexJson = JSON.stringify(template.flexTemplate)

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{${key}}}`, 'g')
      flexJson = flexJson.replace(placeholder, this.formatValue(value, key, template))
    }

    return JSON.parse(flexJson)
  }

  private formatValue(value: any, key: string, template: LineTemplate): string {
    const variable = template.variables.find((v) => v.key === key)
    if (!variable) return String(value)

    switch (variable.type) {
      case 'date':
        return this.formatDate(value)
      case 'currency':
        return this.formatCurrency(value)
      default:
        return String(value)
    }
  }

  private formatDate(value: any): string {
    if (!value) return ''
    const date = new Date(value)
    if (isNaN(date.getTime())) return String(value)
    
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  private formatCurrency(value: any): string {
    const num = Number(value)
    if (isNaN(num)) return String(value)
    
    return new Intl.NumberFormat('th-TH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num)
  }
}

export class LineThrottleService {
  private lastAlertTime: Map<string, number> = new Map()
  private messageHistory: Map<string, number[]> = new Map()

  canSendAlert(alertType: string, throttleMinutes: number): boolean {
    const key = alertType
    const lastSent = this.lastAlertTime.get(key)

    if (!lastSent) return true

    const minutesSince = (Date.now() - lastSent) / 1000 / 60
    return minutesSince >= throttleMinutes
  }

  recordAlert(alertType: string): void {
    this.lastAlertTime.set(alertType, Date.now())
  }

  canSendToRecipient(recipientId: string, maxPerHour: number = 3): boolean {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    
    const history = this.messageHistory.get(recipientId) || []
    const recentMessages = history.filter((timestamp) => timestamp > oneHourAgo)
    
    this.messageHistory.set(recipientId, recentMessages)
    
    return recentMessages.length < maxPerHour
  }

  recordMessage(recipientId: string): void {
    const now = Date.now()
    const history = this.messageHistory.get(recipientId) || []
    history.push(now)
    this.messageHistory.set(recipientId, history)
  }

  cleanupOldRecords(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    
    for (const [recipientId, history] of this.messageHistory.entries()) {
      const recentMessages = history.filter((timestamp) => timestamp > oneHourAgo)
      if (recentMessages.length === 0) {
        this.messageHistory.delete(recipientId)
      } else {
        this.messageHistory.set(recipientId, recentMessages)
      }
    }
  }
}

export const lineService = new LineService()
export const lineTemplateRenderer = new LineTemplateRenderer()
export const lineThrottleService = new LineThrottleService()

setInterval(() => {
  lineThrottleService.cleanupOldRecords()
}, 5 * 60 * 1000)
