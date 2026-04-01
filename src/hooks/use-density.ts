import { useKV } from '@github/spark/hooks'
import { useEffect } from 'react'
import { toast } from 'sonner'

export type Density = 'compact' | 'comfortable'

export function useDensity() {
  const [density, setDensity] = useKV<Density>('app-density', 'compact')

  useEffect(() => {
    if (density === 'compact') {
      document.documentElement.classList.add('density-compact')
      document.documentElement.classList.remove('density-comfortable')
    } else {
      document.documentElement.classList.add('density-comfortable')
      document.documentElement.classList.remove('density-compact')
    }
  }, [density])

  const toggleDensity = () => {
    setDensity((current) => {
      const newDensity = current === 'compact' ? 'comfortable' : 'compact'
      toast.success(`Switched to ${newDensity} view`, {
        description: newDensity === 'compact' ? 'More information on screen' : 'More spacious layout',
        duration: 2000
      })
      return newDensity
    })
  }

  return {
    density,
    setDensity,
    toggleDensity,
    isCompact: density === 'compact',
    isComfortable: density === 'comfortable',
  }
}
