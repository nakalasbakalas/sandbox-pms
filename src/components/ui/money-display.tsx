import { useMemo } from 'react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface MoneyDisplayProps {
  amount: number
  className?: string
  showCode?: boolean
}

export function MoneyDisplay({ amount, className, showCode = false }: MoneyDisplayProps) {
  const { language } = useI18n()

  const formatted = useMemo(() => new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency',
    currency: 'THB',
    currencyDisplay: showCode ? 'code' : 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount), [amount, language, showCode])

  return <span className={cn('tabular-nums', className)}>{formatted}</span>
}
