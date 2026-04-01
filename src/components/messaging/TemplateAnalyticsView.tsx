import { useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Star,
  TrendUp,
  ChartBar,
  Clock,
  CheckCircle,
  Warning,
  ArrowUp,
  ArrowDown,
  Users,
  Star as Sparkle,
} from '@phosphor-icons/react'
import type { StaffMessageTemplate } from '@/types/staff-templates'
import type { StaffDepartment } from '@/types/messaging'
import { DEFAULT_STAFF_TEMPLATES, TEMPLATE_CATEGORIES, getTemplatesByDepartment } from '@/lib/staff-message-templates'
import { format } from 'date-fns'

interface TemplateAnalyticsViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TemplateAnalyticsView({ open, onOpenChange }: TemplateAnalyticsViewProps) {
  const [templates] = useKV<StaffMessageTemplate[]>('staff-message-templates', 
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

  const analytics = useMemo(() => {
    const allTemplates = templates || []
    
    const totalTemplates = allTemplates.length
    const totalUsage = allTemplates.reduce((sum, t) => sum + t.usageCount, 0)
    const customTemplates = allTemplates.filter(t => t.isCustom).length
    const favoriteTemplates = allTemplates.filter(t => t.isFavorite).length
    
    const topTemplates = [...allTemplates]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
    
    const mostEffective = topTemplates.filter(t => t.usageCount > 0)
    
    const leastUsed = [...allTemplates]
      .filter(t => t.usageCount === 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
    
    const byCategory = TEMPLATE_CATEGORIES.map(cat => {
      const catTemplates = allTemplates.filter(t => t.category === cat.value)
      const usage = catTemplates.reduce((sum, t) => sum + t.usageCount, 0)
      return {
        category: cat.label,
        count: catTemplates.length,
        usage,
        avgUsage: catTemplates.length > 0 ? (usage / catTemplates.length).toFixed(1) : '0',
      }
    }).sort((a, b) => b.usage - a.usage)
    
    const byDepartment: Record<StaffDepartment | 'ALL', { count: number; usage: number }> = {
      FRONT_DESK: { count: 0, usage: 0 },
      HOUSEKEEPING: { count: 0, usage: 0 },
      MAINTENANCE: { count: 0, usage: 0 },
      MANAGEMENT: { count: 0, usage: 0 },
      CASHIER: { count: 0, usage: 0 },
      ALL: { count: 0, usage: 0 },
    }
    
    allTemplates.forEach(t => {
      const dept = t.targetDepartment || 'ALL'
      byDepartment[dept].count++
      byDepartment[dept].usage += t.usageCount
    })
    
    const recentlyCreated = [...allTemplates]
      .filter(t => t.isCustom)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
    
    return {
      totalTemplates,
      totalUsage,
      customTemplates,
      favoriteTemplates,
      topTemplates,
      mostEffective,
      leastUsed,
      byCategory,
      byDepartment,
      recentlyCreated,
    }
  }, [templates])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ChartBar size={24} weight="bold" className="text-primary" />
            </div>
            <div>
              <DialogTitle>Template Analytics</DialogTitle>
              <DialogDescription>
                Usage statistics and effectiveness report for message templates
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Total Templates</span>
                  <Sparkle size={18} className="text-primary" />
                </div>
                <div className="text-3xl font-bold">{analytics.totalTemplates}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {analytics.customTemplates} custom
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Total Usage</span>
                  <TrendUp size={18} className="text-green-500" />
                </div>
                <div className="text-3xl font-bold">{analytics.totalUsage}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {analytics.totalTemplates > 0 ? (analytics.totalUsage / analytics.totalTemplates).toFixed(1) : 0} avg per template
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Favorites</span>
                  <Star size={18} weight="fill" className="text-amber-500" />
                </div>
                <div className="text-3xl font-bold">{analytics.favoriteTemplates}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {analytics.totalTemplates > 0 ? ((analytics.favoriteTemplates / analytics.totalTemplates) * 100).toFixed(0) : 0}% of total
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Never Used</span>
                  <Warning size={18} className="text-orange-500" />
                </div>
                <div className="text-3xl font-bold">{analytics.leastUsed.length}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Consider reviewing
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <Card className="p-5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <TrendUp size={20} weight="bold" className="text-primary" />
                  Top 10 Most Used Templates
                </h3>
                <div className="space-y-2">
                  {analytics.topTemplates.map((template, index) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary">{index + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{template.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="h-5">
                              {TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label}
                            </Badge>
                            {template.isFavorite && (
                              <Star size={12} weight="fill" className="text-amber-500" />
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="font-bold text-lg">{template.usageCount}</div>
                        <div className="text-xs text-muted-foreground">uses</div>
                      </div>
                    </div>
                  ))}
                  {analytics.topTemplates.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No templates have been used yet
                    </div>
                  )}
                </div>
              </Card>

              <div className="space-y-6">
                <Card className="p-5">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <ChartBar size={20} weight="bold" className="text-primary" />
                    Usage by Category
                  </h3>
                  <div className="space-y-3">
                    {analytics.byCategory.map((cat) => (
                      <div key={cat.category}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{cat.category}</span>
                          <div className="text-xs text-muted-foreground">
                            {cat.count} templates • {cat.usage} uses
                          </div>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{
                              width: `${analytics.totalUsage > 0 ? (cat.usage / analytics.totalUsage) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Avg: {cat.avgUsage} uses per template
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Users size={20} weight="bold" className="text-primary" />
                    Usage by Department
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(analytics.byDepartment)
                      .sort((a, b) => b[1].usage - a[1].usage)
                      .map(([dept, data]) => (
                        <div
                          key={dept}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {dept === 'ALL' ? 'All Staff' : dept.replace('_', ' ')}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {data.count} templates
                            </span>
                          </div>
                          <div className="font-semibold">{data.usage} uses</div>
                        </div>
                      ))}
                  </div>
                </Card>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <Card className="p-5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <CheckCircle size={20} weight="bold" className="text-green-500" />
                  Most Effective Templates
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Templates with highest usage - consider making these favorites
                </p>
                <div className="space-y-2">
                  {analytics.mostEffective.slice(0, 5).map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{template.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          {template.usageCount} uses
                        </Badge>
                        {!template.isFavorite && (
                          <Star size={16} className="text-muted-foreground" />
                        )}
                        {template.isFavorite && (
                          <Star size={16} weight="fill" className="text-amber-500" />
                        )}
                      </div>
                    </div>
                  ))}
                  {analytics.mostEffective.length === 0 && (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      Start using templates to see effectiveness data
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Warning size={20} weight="bold" className="text-orange-500" />
                  Unused Templates
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Templates that have never been used - consider removing or improving
                </p>
                <div className="space-y-2">
                  {analytics.leastUsed.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-orange-200 bg-orange-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{template.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label}
                          {template.isCustom && ' • Custom'}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-orange-300 text-orange-700">
                        0 uses
                      </Badge>
                    </div>
                  ))}
                  {analytics.leastUsed.length === 0 && (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      All templates have been used!
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {analytics.recentlyCreated.length > 0 && (
              <Card className="p-5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Clock size={20} weight="bold" className="text-primary" />
                  Recently Created Custom Templates
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {analytics.recentlyCreated.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{template.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Created {format(new Date(template.createdAt), 'MMM d, yyyy')}
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {template.usageCount} uses
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t flex justify-end">
          <Button onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
