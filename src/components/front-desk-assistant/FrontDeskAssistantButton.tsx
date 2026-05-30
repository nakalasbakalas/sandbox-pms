import { Sparkle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useFrontDeskAssistant } from './FrontDeskAssistantProvider'

export function FrontDeskAssistantButton() {
  const { openAssistant } = useFrontDeskAssistant()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => openAssistant()}
      className="h-8 gap-1.5 px-2.5 text-xs font-medium"
    >
      <Sparkle size={15} weight="duotone" className="text-blue-600" />
      Front Desk AI
    </Button>
  )
}
