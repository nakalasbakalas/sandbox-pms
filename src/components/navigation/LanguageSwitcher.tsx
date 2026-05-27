import { GlobeHemisphereEast } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()
  const nextLanguage = language === 'th' ? 'en' : 'th'

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-2 px-2 text-muted-foreground hover:text-foreground"
      aria-label={t('app.language')}
      onClick={() => setLanguage(nextLanguage)}
    >
      <GlobeHemisphereEast size={16} weight="duotone" />
      <span className="text-xs font-semibold">{language === 'th' ? 'ไทย' : 'EN'}</span>
    </Button>
  )
}
