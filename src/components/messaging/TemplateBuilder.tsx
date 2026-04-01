import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
  Plus,
  X,
  PlusCircle,
  Lightbulb,
} from '@phosphor-icons/react'
import type { StaffMessageTemplate, StaffTemplateCategory, TemplateVariable } from '@/types/staff-templates'
import type { InternalMessagePriority, StaffDepartment } from '@/types/messaging'
import { TEMPLATE_CATEGORIES, extractTemplateVariables } from '@/lib/staff-message-templates'
import { toast } from 'sonner'

interface TemplateBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (template: Omit<StaffMessageTemplate, 'id' | 'usageCount' | 'isFavorite' | 'createdAt' | 'updatedAt'>) => void
  editTemplate?: StaffMessageTemplate
}

export function TemplateBuilder({ open, onOpenChange, onSave, editTemplate }: TemplateBuilderProps) {
  const [name, setName] = useState(editTemplate?.name || '')
  const [category, setCategory] = useState<StaffTemplateCategory>(editTemplate?.category || 'CUSTOM')
  const [targetDepartment, setTargetDepartment] = useState<StaffDepartment>(editTemplate?.targetDepartment || 'ALL')
  const [priority, setPriority] = useState<InternalMessagePriority>(editTemplate?.priority || 'NORMAL')
  const [subject, setSubject] = useState(editTemplate?.subject || '')
  const [body, setBody] = useState(editTemplate?.body || '')
  const [requiresAcknowledgment, setRequiresAcknowledgment] = useState(editTemplate?.requiresAcknowledgment || false)
  const [tags, setTags] = useState<string[]>(editTemplate?.tags || [])
  const [newTag, setNewTag] = useState('')
  const [variables, setVariables] = useState<TemplateVariable[]>(editTemplate?.variables || [])
  const [showVariableHelper, setShowVariableHelper] = useState(false)

  const detectedVariables = extractTemplateVariables(body)

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()])
      setNewTag('')
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove))
  }

  const handleAddVariable = () => {
    setVariables([
      ...variables,
      {
        key: '',
        label: '',
        type: 'text',
        required: false,
        placeholder: '',
      },
    ])
  }

  const handleUpdateVariable = (index: number, field: keyof TemplateVariable, value: any) => {
    const updated = [...variables]
    updated[index] = { ...updated[index], [field]: value }
    setVariables(updated)
  }

  const handleRemoveVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
  }

  const handleAutoDetectVariables = () => {
    const newVariables: TemplateVariable[] = detectedVariables.map(varKey => ({
      key: varKey,
      label: varKey.split(/(?=[A-Z])/).join(' ').replace(/^\w/, c => c.toUpperCase()),
      type: 'text' as const,
      required: true,
      placeholder: `Enter ${varKey}`,
    }))
    setVariables(newVariables)
    toast.success(`Detected ${newVariables.length} variables`)
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Please enter a template name')
      return
    }
    if (!body.trim()) {
      toast.error('Please enter a message body')
      return
    }

    const missingVariables = detectedVariables.filter(
      dv => !variables.some(v => v.key === dv)
    )

    if (missingVariables.length > 0) {
      toast.error(`Missing variable definitions: ${missingVariables.join(', ')}`)
      return
    }

    const template: Omit<StaffMessageTemplate, 'id' | 'usageCount' | 'isFavorite' | 'createdAt' | 'updatedAt'> = {
      name: name.trim(),
      category,
      targetDepartment,
      priority,
      subject: subject.trim() || undefined,
      body: body.trim(),
      variables,
      requiresAcknowledgment,
      tags,
      isCustom: true,
      updatedAt: new Date(),
    }

    onSave(template)
    onOpenChange(false)
    resetForm()
    toast.success('Template saved successfully')
  }

  const resetForm = () => {
    setName('')
    setCategory('CUSTOM')
    setTargetDepartment('ALL')
    setPriority('NORMAL')
    setSubject('')
    setBody('')
    setRequiresAcknowledgment(false)
    setTags([])
    setVariables([])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editTemplate ? 'Edit Template' : 'Create Custom Template'}</DialogTitle>
          <DialogDescription>
            Build a reusable message template for common communications
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Template Name *</Label>
              <Input
                placeholder="e.g. Guest Wifi Issue"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Target Department</Label>
              <Select value={targetDepartment} onValueChange={(v: any) => setTargetDepartment(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Staff</SelectItem>
                  <SelectItem value="FRONT_DESK">Front Desk</SelectItem>
                  <SelectItem value="HOUSEKEEPING">Housekeeping</SelectItem>
                  <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                  <SelectItem value="MANAGEMENT">Management</SelectItem>
                  <SelectItem value="CASHIER">Cashier</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Subject (Optional)</Label>
            <Input
              placeholder="Optional subject line"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Message Body *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowVariableHelper(!showVariableHelper)}
              >
                <Lightbulb size={16} className="mr-2" />
                Variable Helper
              </Button>
            </div>
            
            {showVariableHelper && (
              <Card className="p-3 mb-2 text-sm text-muted-foreground">
                <p className="font-medium mb-1">How to use variables:</p>
                <p>Use double curly braces to create variables: <code className="bg-muted px-1 py-0.5 rounded">{'{{variableName}}'}</code></p>
                <p className="mt-1">Example: <code className="bg-muted px-1 py-0.5 rounded">Room {'{{roomNumber}}'} needs attention</code></p>
              </Card>
            )}

            <Textarea
              placeholder="Type your message here. Use {{variableName}} for dynamic values."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="resize-none font-mono text-sm"
            />

            {detectedVariables.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Detected variables: {detectedVariables.join(', ')}
                </span>
                {variables.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAutoDetectVariables}
                  >
                    <PlusCircle size={14} className="mr-1" />
                    Auto-configure
                  </Button>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Variable Configuration</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddVariable}
              >
                <Plus size={16} className="mr-1" />
                Add Variable
              </Button>
            </div>

            <div className="space-y-2">
              {variables.map((variable, index) => (
                <Card key={index} className="p-3">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-3">
                      <Input
                        placeholder="Key (e.g. roomNumber)"
                        value={variable.key}
                        onChange={(e) => handleUpdateVariable(index, 'key', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        placeholder="Label (e.g. Room Number)"
                        value={variable.label}
                        onChange={(e) => handleUpdateVariable(index, 'label', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <Select
                        value={variable.type}
                        onValueChange={(v: any) => handleUpdateVariable(index, 'type', v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="room">Room</SelectItem>
                          <SelectItem value="guest">Guest</SelectItem>
                          <SelectItem value="time">Time</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Input
                        placeholder="Placeholder"
                        value={variable.placeholder || ''}
                        onChange={(e) => handleUpdateVariable(index, 'placeholder', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="col-span-1 flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant={variable.required ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleUpdateVariable(index, 'required', !variable.required)}
                        className="h-9 w-9 p-0"
                        title={variable.required ? 'Required' : 'Optional'}
                      >
                        *
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveVariable(index)}
                        className="h-9 w-9 p-0"
                      >
                        <X size={16} />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}

              {variables.length === 0 && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No variables configured. Add variables or use auto-detect if you've added {'{{variables}}'} to your message.
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>Tags</Label>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Add a tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={handleAddTag}>
                <Plus size={16} />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive"
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requiresAck"
              checked={requiresAcknowledgment}
              onChange={(e) => setRequiresAcknowledgment(e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="requiresAck" className="cursor-pointer">
              Requires acknowledgment from recipients
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
