import {
  AlertType,
  AlertRoutingRule,
  AlertInstance,
  StaffMember,
  AlertRecipient,
  AlertPriority,
  ALERT_TYPE_METADATA,
} from '@/types/staff-alerts'
import { LineConfig } from '@/types/line'

interface AlertContext {
  reservationId?: string
  guestName?: string
  roomNumber?: string
  amount?: number
  date?: string
  source?: string
  error?: string
  [key: string]: unknown
}

interface AlertThrottleState {
  [ruleId: string]: {
    hourlyCount: number
    dailyCount: number
    lastHourReset: Date
    lastDayReset: Date
  }
}

class AlertRoutingService {
  private throttleState: AlertThrottleState = {}

  async routeAlert(
    alertType: AlertType,
    context: AlertContext,
    routingRules: AlertRoutingRule[],
    staffMembers: StaffMember[],
    lineConfig: LineConfig
  ): Promise<AlertInstance | null> {
    const rule = routingRules.find((r) => r.alertType === alertType && r.enabled)
    
    if (!rule) {
      console.log(`No enabled routing rule found for alert type: ${alertType}`)
      return null
    }

    if (!this.checkSchedule(rule)) {
      console.log(`Alert ${alertType} suppressed due to schedule restrictions`)
      return this.createSuppressedAlert(rule, context)
    }

    if (!this.checkThrottle(rule)) {
      console.log(`Alert ${alertType} throttled`)
      return this.createThrottledAlert(rule, context)
    }

    const recipients = this.resolveRecipients(rule, staffMembers)
    
    if (recipients.length === 0) {
      console.log(`No recipients found for alert type: ${alertType}`)
      return null
    }

    const alert = this.createAlert(rule, context, recipients)

    if (rule.testMode || lineConfig.testMode) {
      console.log(`Alert in test mode:`, alert)
      return alert
    }

    await this.sendAlert(alert, rule, lineConfig)

    this.updateThrottle(rule)

    return alert
  }

  private checkSchedule(rule: AlertRoutingRule): boolean {
    if (!rule.schedule.enabled) {
      return true
    }

    const now = new Date()
    const dayOfWeek = now.getDay()
    
    if (!rule.schedule.daysOfWeek.includes(dayOfWeek)) {
      return false
    }

    if (rule.schedule.onlyDuringBusinessHours) {
      const currentTime = now.getHours() * 60 + now.getMinutes()
      const [startHour, startMin] = rule.schedule.businessHoursStart.split(':').map(Number)
      const [endHour, endMin] = rule.schedule.businessHoursEnd.split(':').map(Number)
      
      const startTime = startHour * 60 + startMin
      const endTime = endHour * 60 + endMin
      
      if (currentTime < startTime || currentTime > endTime) {
        return false
      }
    }

    return true
  }

  private checkThrottle(rule: AlertRoutingRule): boolean {
    if (!rule.throttle.enabled) {
      return true
    }

    const state = this.getThrottleState(rule.id)
    const now = new Date()

    if (now.getTime() - state.lastHourReset.getTime() > 60 * 60 * 1000) {
      state.hourlyCount = 0
      state.lastHourReset = now
    }

    if (now.getTime() - state.lastDayReset.getTime() > 24 * 60 * 60 * 1000) {
      state.dailyCount = 0
      state.lastDayReset = now
    }

    if (state.hourlyCount >= rule.throttle.maxPerHour) {
      return false
    }

    if (state.dailyCount >= rule.throttle.maxPerDay) {
      return false
    }

    return true
  }

  private updateThrottle(rule: AlertRoutingRule): void {
    if (!rule.throttle.enabled) {
      return
    }

    const state = this.getThrottleState(rule.id)
    state.hourlyCount++
    state.dailyCount++
  }

  private getThrottleState(ruleId: string) {
    if (!this.throttleState[ruleId]) {
      this.throttleState[ruleId] = {
        hourlyCount: 0,
        dailyCount: 0,
        lastHourReset: new Date(),
        lastDayReset: new Date(),
      }
    }
    return this.throttleState[ruleId]
  }

  private resolveRecipients(
    rule: AlertRoutingRule,
    staffMembers: StaffMember[]
  ): AlertRecipient[] {
    const recipients: AlertRecipient[] = []

    const activeStaff = staffMembers.filter((s) => s.active && s.receiveAlerts)

    if (rule.recipientsByRole.length > 0) {
      const staffByRole = activeStaff.filter((s) => 
        rule.recipientsByRole.includes(s.role)
      )
      
      for (const staff of staffByRole) {
        recipients.push({
          staffId: staff.id,
          staffName: staff.name,
          role: staff.role,
          lineUserId: staff.lineUserId,
          phoneNumber: staff.phoneNumber,
          email: staff.email,
        })
      }
    }

    if (rule.recipients.length > 0) {
      recipients.push(...rule.recipients)
    }

    const uniqueRecipients = recipients.filter(
      (r, index, self) => self.findIndex((t) => t.staffId === r.staffId) === index
    )

    return uniqueRecipients
  }

  private createAlert(
    rule: AlertRoutingRule,
    context: AlertContext,
    recipients: AlertRecipient[]
  ): AlertInstance {
    const metadata = ALERT_TYPE_METADATA[rule.alertType]
    
    const alert: AlertInstance = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      alertType: rule.alertType,
      priority: rule.priority,
      title: this.formatTitle(rule.alertType, context),
      message: this.formatMessage(rule.alertType, context),
      context,
      routingRuleId: rule.id,
      recipients,
      status: 'PENDING',
      deliveryStatus: [],
      acknowledged: false,
      createdAt: new Date(),
    }

    return alert
  }

  private createSuppressedAlert(rule: AlertRoutingRule, context: AlertContext): AlertInstance {
    const alert = this.createAlert(rule, context, [])
    alert.status = 'SUPPRESSED'
    return alert
  }

  private createThrottledAlert(rule: AlertRoutingRule, context: AlertContext): AlertInstance {
    const alert = this.createAlert(rule, context, [])
    alert.status = 'THROTTLED'
    return alert
  }

  private formatTitle(alertType: AlertType, context: AlertContext): string {
    const metadata = ALERT_TYPE_METADATA[alertType]
    
    switch (alertType) {
      case 'NEW_BOOKING':
        return `New Booking: ${context.guestName || 'Guest'}`
      case 'DEPOSIT_PENDING':
        return `Deposit Pending: ${context.guestName || 'Guest'}`
      case 'ARRIVAL_TODAY':
        return 'Today\'s Arrivals Summary'
      case 'DEPARTURE_TODAY':
        return 'Today\'s Departures Summary'
      case 'NO_SHOW_CANDIDATE':
        return `No-Show Alert: ${context.guestName || 'Guest'}`
      case 'SYNC_FAILURE':
        return `OTA Sync Failure: ${context.source || 'Unknown'}`
      case 'HOUSEKEEPING_URGENT':
        return `Urgent Housekeeping: Room ${context.roomNumber || ''}`
      case 'MAINTENANCE_REQUIRED':
        return `Maintenance Required: Room ${context.roomNumber || ''}`
      case 'MANAGER_EXCEPTION':
        return 'Manager Approval Required'
      case 'PAYMENT_OVERDUE':
        return `Payment Overdue: ${context.guestName || 'Guest'}`
      case 'INVENTORY_CONFLICT':
        return 'Inventory Conflict Detected'
      default:
        return metadata.label
    }
  }

  private formatMessage(alertType: AlertType, context: AlertContext): string {
    switch (alertType) {
      case 'NEW_BOOKING':
        return `New reservation created for ${context.guestName || 'guest'}${
          context.roomNumber ? ` in Room ${context.roomNumber}` : ''
        }${context.date ? ` on ${context.date}` : ''}`
      
      case 'DEPOSIT_PENDING':
        return `Deposit payment pending for ${context.guestName || 'guest'}${
          context.amount ? ` - Amount: ${context.amount} THB` : ''
        }`
      
      case 'ARRIVAL_TODAY':
        return `${context.amount || 0} arrivals expected today`
      
      case 'DEPARTURE_TODAY':
        return `${context.amount || 0} departures expected today`
      
      case 'NO_SHOW_CANDIDATE':
        return `${context.guestName || 'Guest'} has not checked in${
          context.roomNumber ? ` for Room ${context.roomNumber}` : ''
        }`
      
      case 'SYNC_FAILURE':
        return `Failed to sync with ${context.source || 'OTA'}${
          context.error ? `: ${context.error}` : ''
        }`
      
      case 'HOUSEKEEPING_URGENT':
        return `Room ${context.roomNumber || ''} requires urgent attention`
      
      case 'MAINTENANCE_REQUIRED':
        return `Maintenance issue reported for Room ${context.roomNumber || ''}`
      
      case 'MANAGER_EXCEPTION':
        return `Manager approval required${context.guestName ? ` for ${context.guestName}` : ''}`
      
      case 'PAYMENT_OVERDUE':
        return `Payment is overdue for ${context.guestName || 'guest'}${
          context.amount ? ` - Amount: ${context.amount} THB` : ''
        }`
      
      case 'INVENTORY_CONFLICT':
        return `Room availability conflict detected${
          context.roomNumber ? ` for Room ${context.roomNumber}` : ''
        }`
      
      default:
        return 'Alert notification'
    }
  }

  private async sendAlert(
    alert: AlertInstance,
    rule: AlertRoutingRule,
    lineConfig: LineConfig
  ): Promise<void> {
    const deliveryPromises: Promise<void>[] = []

    for (const recipient of alert.recipients) {
      if (rule.channels.line && recipient.lineUserId && lineConfig.enabled) {
        deliveryPromises.push(
          this.sendViaLine(alert, recipient, lineConfig)
        )
      }

      if (rule.channels.email && recipient.email) {
        deliveryPromises.push(
          this.sendViaEmail(alert, recipient)
        )
      }

      if (rule.channels.sms && recipient.phoneNumber) {
        deliveryPromises.push(
          this.sendViaSMS(alert, recipient)
        )
      }
    }

    await Promise.allSettled(deliveryPromises)
    
    alert.status = alert.deliveryStatus.some((d) => d.status === 'SENT' || d.status === 'DELIVERED')
      ? 'SENT'
      : 'FAILED'
    
    alert.sentAt = new Date()
  }

  private async sendViaLine(
    alert: AlertInstance,
    recipient: AlertRecipient,
    lineConfig: LineConfig
  ): Promise<void> {
    try {
      console.log(`Sending LINE alert to ${recipient.staffName} (${recipient.lineUserId})`)
      
      const message = this.formatLineMessage(alert)
      
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'line',
        status: 'SENT',
        sentAt: new Date(),
      })
    } catch (error) {
      console.error('Failed to send LINE alert:', error)
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'line',
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async sendViaEmail(alert: AlertInstance, recipient: AlertRecipient): Promise<void> {
    try {
      console.log(`Sending email alert to ${recipient.staffName} (${recipient.email})`)
      
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'email',
        status: 'SENT',
        sentAt: new Date(),
      })
    } catch (error) {
      console.error('Failed to send email alert:', error)
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'email',
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async sendViaSMS(alert: AlertInstance, recipient: AlertRecipient): Promise<void> {
    try {
      console.log(`Sending SMS alert to ${recipient.staffName} (${recipient.phoneNumber})`)
      
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'sms',
        status: 'SENT',
        sentAt: new Date(),
      })
    } catch (error) {
      console.error('Failed to send SMS alert:', error)
      alert.deliveryStatus.push({
        recipientId: recipient.staffId,
        channel: 'sms',
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private formatLineMessage(alert: AlertInstance): string {
    const metadata = ALERT_TYPE_METADATA[alert.alertType]
    
    let message = `${metadata.icon} ${alert.title}\n\n`
    message += alert.message
    
    if (alert.context.reservationId) {
      message += `\n\nReservation: ${alert.context.reservationId}`
    }
    
    if (alert.priority === 'CRITICAL' || alert.priority === 'HIGH') {
      message += `\n\n⚠️ Priority: ${alert.priority}`
    }
    
    return message
  }

  resetThrottle(ruleId?: string): void {
    if (ruleId) {
      delete this.throttleState[ruleId]
    } else {
      this.throttleState = {}
    }
  }
}

export const alertRoutingService = new AlertRoutingService()

export async function sendStaffAlert(
  alertType: AlertType,
  context: AlertContext
): Promise<AlertInstance | null> {
  try {
    const sparkRuntime = window.spark
    if (!sparkRuntime) {
      console.error('Spark runtime is not available for alert routing')
      return null
    }

    const routingRules = await sparkRuntime.kv.get<AlertRoutingRule[]>('alert-routing-rules')
    const staffMembers = await sparkRuntime.kv.get<StaffMember[]>('staff-members')
    const lineConfig = await sparkRuntime.kv.get<LineConfig>('line-config')
    
    if (!routingRules || !staffMembers || !lineConfig) {
      console.error('Missing required configuration for alert routing')
      return null
    }
    
    return await alertRoutingService.routeAlert(
      alertType,
      context,
      routingRules,
      staffMembers,
      lineConfig
    )
  } catch (error) {
    console.error('Failed to send staff alert:', error)
    return null
  }
}

export async function logAlertInstance(alert: AlertInstance): Promise<void> {
  try {
    const sparkRuntime = window.spark
    if (!sparkRuntime) {
      console.error('Spark runtime is not available for alert logging')
      return
    }

    const alertLog = await sparkRuntime.kv.get<AlertInstance[]>('alert-log') || []
    alertLog.unshift(alert)
    
    const maxLogSize = 1000
    if (alertLog.length > maxLogSize) {
      alertLog.splice(maxLogSize)
    }
    
    await sparkRuntime.kv.set('alert-log', alertLog)
  } catch (error) {
    console.error('Failed to log alert instance:', error)
  }
}
