import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Star,
  TrendUp,
  PaperPlaneTilt,
  X,
  Plus,
  MagnifyingGlass,
  Bed,
  User,
  Wrench,
  ArrowsClockwise,
  Warning,
  CalendarBlank,
  PencilSimple,
} from '@phosphor-icons/react'
import type { StaffMessageTemplate, StaffTemplateCategory, TemplateVariable } from '@/types/staff-templates'
import type { InternalMessage, InternalMessagePriority, StaffDepartment, StaffMember, InternalChannel } from '@/types/messaging'
import { 
  DEFAULT_STAFF_TEMPLATES, 
  createTemplateId,
  replaceTemplateVariables,
  getTemplatesByCategory,
  getFavoriteTemplates,
  getMostUsedTemplates,
  TEMPLATE_CATEGORIES,
} from '@/lib/staff-message-templates'
import { toast } from 'sonner'

interface MessageTemplatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffMember[]
  channels: InternalChannel[]
  onSendMessage: (message: InternalMessage) => void
  currentUserId: string
  currentUserName: string
  currentUserDept: StaffDepartment
}

export function MessageTemplatesDialog({
  open,
  onOpenChange,
  staff,
  channels,
  onSendMessage,
  currentUserId,
  currentUserName,
  currentUserDept,
}: MessageTemplatesDialogProps) {
  const [templates, setTemplates] = useKV<StaffMessageTemplate[]>('staff-message-templates', 
    DEFAULT_STAFF_TEMPLATES.map((tmpl, idx) => ({
      ...tmpl,
      id: `tmpl-default-${idx}`,
      usageCount: 0,
      isFavorite: false,
      isCustom: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  
  const [selectedTemplate, setSelectedTemplate] = useState<StaffMessageTemplate | null>(null)
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<StaffTemplateCategory | 'ALL'>('ALL')
  const [recipientType, setRecipientType] = useState<'STAFF' | 'CHANNEL' | 'DEPARTMENT'>('STAFF')
  const [recipientId, setRecipientId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [department, setDepartment] = useState<StaffDepartment>('ALL')

  const filteredTemplates = useMemo(() => {
    let filtered = templates || []
    
    if (selectedCategory !== 'ALL') {
      filtered = getTemplatesByCategory(filtered, selectedCategory)
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query) ||
        t.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }
    
    return filtered
  }, [templates, selectedCategory, searchQuery])

  const favoriteTemplates = useMemo(() => getFavoriteTemplates(templates || []), [templates])
  const mostUsedTemplates = useMemo(() => getMostUsedTemplates(templates || [], 5), [templates])

  const handleSelectTemplate = (template: StaffMessageTemplate) => {
    setSelectedTemplate(template)
    
    const defaultValues: Record<string, string> = {}
    template.variables.forEach(variable => {
      if (variable.defaultValue) {
        defaultValues[variable.key] = variable.defaultValue
      }
    })
    setTemplateValues(defaultValues)
    
    if (template.targetDepartment) {
      setDepartment(template.targetDepartment)
      setRecipientType('DEPARTMENT')
    }
  }

  const handleToggleFavorite = (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTemplates(current =>
      (current || []).map(t =>
        t.id === templateId ? { ...t, isFavorite: !t.isFavorite } : t
      )
    )
  }

  const handleSendFromTemplate = () => {
    if (!selectedTemplate) return

    const missingRequired = selectedTemplate.variables
      .filter(v => v.required && !templateValues[v.key])
      .map(v => v.label)

    if (missingRequired.length > 0) {
      toast.error(`Missing required fields: ${missingRequired.join(', ')}`)
      return
    }

    if (recipientType === 'STAFF' && !recipientId) {
      toast.error('Please select a recipient')
      return
    }

    if (recipientType === 'CHANNEL' && !channelId) {
      toast.error('Please select a channel')
      return
    }

    const messageBody = replaceTemplateVariables(selectedTemplate.body, templateValues)
    const recipient = staff.find(s => s.id === recipientId)
    const channel = channels.find(c => c.id === channelId)

    const message: InternalMessage = {
      id: `msg-${Date.now()}`,
      type: recipientType === 'CHANNEL' ? 'CHANNEL' : recipientType === 'DEPARTMENT' ? 'BROADCAST' : 'DIRECT',
      priority: selectedTemplate.priority,
      senderId: currentUserId,
      senderName: currentUserName,
      senderDepartment: currentUserDept,
      recipientId: recipientType === 'STAFF' ? recipientId : undefined,
      recipientName: recipient?.name,
      channelId: recipientType === 'CHANNEL' ? channelId : undefined,
      channelName: channel?.name,
      department: recipientType === 'DEPARTMENT' ? department : undefined,
      subject: selectedTemplate.subject,
      body: messageBody,
      isRead: false,
      readBy: [],
      isPinned: false,
      isUrgent: selectedTemplate.priority === 'URGENT',
      requiresAcknowledgment: selectedTemplate.requiresAcknowledgment,
      acknowledgedBy: [],
      mentions: [],
      tags: selectedTemplate.tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setTemplates(current =>
      (current || []).map(t =>
        t.id === selectedTemplate.id ? { ...t, usageCount: t.usageCount + 1 } : t
      )
    )

    onSendMessage(message)
    onOpenChange(false)
    setSelectedTemplate(null)
    setTemplateValues({})
    
    toast.success('Message sent from template', {
      description: selectedTemplate.name,
    })
  }

  const getCategoryIcon = (category: StaffTemplateCategory) => {
    const iconMap = {
      ROOM_STATUS: Bed,
      GUEST_REQUEST: User,
      MAINTENANCE: Wrench,
      SHIFT_HANDOVER: ArrowsClockwise,
      URGENT_ALERT: Warning,
      DAILY_OPERATIONS: CalendarBlank,
      CUSTOM: PencilSimple,
    }
    return iconMap[category]
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Message Templates</DialogTitle>
          <DialogDescription>
            Select a template to quickly send common staff communications
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-2/5 border-r flex flex-col">
            <div className="px-4 pb-4 space-y-3">
              <div className="relative">
                <MagnifyingGlass 
                  size={16} 
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              
              <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as any)}>
                <TabsList className="w-full grid grid-cols-3">
                  <TabsTrigger value="ALL">All</TabsTrigger>
                  <TabsTrigger value="FAVORITE">
                    <Star size={14} weight="fill" className="mr-1" />
                    Favorites
                  </TabsTrigger>
                  <TabsTrigger value="POPULAR">
                    <TrendUp size={14} className="mr-1" />
                    Popular
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="flex-1 px-4">
              {selectedCategory === 'FAVORITE' ? (
                <TemplateList
                  templates={favoriteTemplates}
                  selectedTemplate={selectedTemplate}
                  onSelect={handleSelectTemplate}
                  onToggleFavorite={handleToggleFavorite}
                  getCategoryIcon={getCategoryIcon}
                />
              ) : selectedCategory === 'POPULAR' ? (
                <TemplateList
                  templates={mostUsedTemplates}
                  selectedTemplate={selectedTemplate}
                  onSelect={handleSelectTemplate}
                  onToggleFavorite={handleToggleFavorite}
                  getCategoryIcon={getCategoryIcon}
                />
              ) : (
                <div className="space-y-6 pb-4">
                  {TEMPLATE_CATEGORIES.map(category => {
                    const categoryTemplates = getTemplatesByCategory(filteredTemplates, category.value)
                    if (categoryTemplates.length === 0) return null
                    
                    return (
                      <div key={category.value}>
                        <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase">
                          {category.label}
                        </div>
                        <TemplateList
                          templates={categoryTemplates}
                          selectedTemplate={selectedTemplate}
                          onSelect={handleSelectTemplate}
                          onToggleFavorite={handleToggleFavorite}
                          getCategoryIcon={getCategoryIcon}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col">
            {selectedTemplate ? (
              <>
                <div className="px-6 py-4 border-b">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1">{selectedTemplate.name}</h3>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {TEMPLATE_CATEGORIES.find(c => c.value === selectedTemplate.category)?.label}
                        </Badge>
                        <PriorityBadge priority={selectedTemplate.priority} />
                        {selectedTemplate.requiresAcknowledgment && (
                          <Badge variant="outline" className="text-xs">
                            Requires Ack
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedTemplate(null)}
                    >
                      <X size={20} />
                    </Button>
                  </div>
                </div>

                <ScrollArea className="flex-1 px-6 py-4">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Send To</Label>
                        <Select value={recipientType} onValueChange={(v: any) => setRecipientType(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="STAFF">Staff Member</SelectItem>
                            <SelectItem value="CHANNEL">Channel</SelectItem>
                            <SelectItem value="DEPARTMENT">Department</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {recipientType === 'STAFF' && (
                        <div>
                          <Label>Staff Member</Label>
                          <Select value={recipientId} onValueChange={setRecipientId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select staff" />
                            </SelectTrigger>
                            <SelectContent>
                              {staff.map(member => (
                                <SelectItem key={member.id} value={member.id}>
                                  {member.name} - {member.role}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {recipientType === 'CHANNEL' && (
                        <div>
                          <Label>Channel</Label>
                          <Select value={channelId} onValueChange={setChannelId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select channel" />
                            </SelectTrigger>
                            <SelectContent>
                              {channels.map(channel => (
                                <SelectItem key={channel.id} value={channel.id}>
                                  #{channel.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {recipientType === 'DEPARTMENT' && (
                        <div>
                          <Label>Department</Label>
                          <Select value={department} onValueChange={(v: any) => setDepartment(v)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="FRONT_DESK">Front Desk</SelectItem>
                              <SelectItem value="HOUSEKEEPING">Housekeeping</SelectItem>
                              <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                              <SelectItem value="MANAGEMENT">Management</SelectItem>
                              <SelectItem value="CASHIER">Cashier</SelectItem>
                              <SelectItem value="ALL">All Staff</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div>
                      <Label className="text-sm font-semibold mb-3 block">Template Variables</Label>
                      <div className="space-y-3">
                        {selectedTemplate.variables.map((variable) => (
                          <TemplateVariableInput
                            key={variable.key}
                            variable={variable}
                            value={templateValues[variable.key] || ''}
                            onChange={(value) => setTemplateValues(prev => ({ ...prev, [variable.key]: value }))}
                          />
                        ))}
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <Label className="text-sm font-semibold mb-2 block">Message Preview</Label>
                      <Card className="p-4">
                        <div className="text-sm whitespace-pre-wrap">
                          {replaceTemplateVariables(selectedTemplate.body, templateValues)}
                        </div>
                      </Card>
                    </div>
                  </div>
                </ScrollArea>

                <div className="px-6 py-4 border-t flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    {selectedTemplate.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSendFromTemplate}>
                      <PaperPlaneTilt size={16} weight="bold" className="mr-2" />
                      Send Message
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <div className="max-w-sm">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <PaperPlaneTilt size={32} className="text-primary" weight="duotone" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Select a Template</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a message template from the list to quickly send common staff communications
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface TemplateListProps {
  templates: StaffMessageTemplate[]
  selectedTemplate: StaffMessageTemplate | null
  onSelect: (template: StaffMessageTemplate) => void
  onToggleFavorite: (templateId: string, e: React.MouseEvent) => void
  getCategoryIcon: (category: StaffTemplateCategory) => React.ComponentType<any>
}

function TemplateList({ templates, selectedTemplate, onSelect, onToggleFavorite, getCategoryIcon }: TemplateListProps) {
  if (templates.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No templates found
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {templates.map(template => {
        const Icon = getCategoryIcon(template.category)
        return (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className={`w-full text-left p-3 rounded-lg transition-colors border ${
              selectedTemplate?.id === template.id
                ? 'bg-primary/10 border-primary/20'
                : 'hover:bg-muted border-transparent'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Icon size={16} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-sm truncate">{template.name}</span>
              </div>
              <button
                onClick={(e) => onToggleFavorite(template.id, e)}
                className="shrink-0"
              >
                <Star
                  size={16}
                  weight={template.isFavorite ? 'fill' : 'regular'}
                  className={template.isFavorite ? 'text-amber-500' : 'text-muted-foreground'}
                />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge priority={template.priority} size="sm" />
              {template.usageCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Used {template.usageCount}x
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

interface TemplateVariableInputProps {
  variable: TemplateVariable
  value: string
  onChange: (value: string) => void
}

function TemplateVariableInput({ variable, value, onChange }: TemplateVariableInputProps) {
  return (
    <div>
      <Label className="text-xs">
        {variable.label}
        {variable.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {variable.type === 'text' && variable.label.toLowerCase().includes('description') ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.placeholder}
          rows={2}
          className="resize-none"
        />
      ) : (
        <Input
          type={variable.type === 'number' ? 'number' : variable.type === 'date' ? 'date' : variable.type === 'time' ? 'time' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={variable.placeholder}
        />
      )}
    </div>
  )
}

interface PriorityBadgeProps {
  priority: InternalMessagePriority
  size?: 'sm' | 'md'
}

function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const variants = {
    NORMAL: { variant: 'secondary' as const, label: 'Normal', className: '' },
    HIGH: { variant: 'secondary' as const, label: 'High', className: 'bg-orange-100 text-orange-700 border-orange-200' },
    URGENT: { variant: 'destructive' as const, label: 'Urgent', className: '' },
  }

  const config = variants[priority]
  const heightClass = size === 'sm' ? 'h-5' : 'h-6'

  return (
    <Badge variant={config.variant} className={`${heightClass} text-xs ${config.className}`}>
      {priority === 'URGENT' && <Warning size={12} weight="bold" className="mr-1" />}
      {config.label}
    </Badge>
  )
}
