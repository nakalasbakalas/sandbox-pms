import { useKV } from '@github/spark/hooks'
import { useEffect } from 'react'
import { toast } from 'sonner'

export type Density = 'compact' | 'comfortable'

export function useDensity() {
  const [density, setDensity] = useKV<Density>('app-density', 'compact')

  useEffect(() => {
    const root = document.documentElement
    
    root.classList.add('density-transitioning')
    
    if (density === 'compact') {
      root.classList.add('density-compact')
      root.classList.remove('density-comfortable')
    } else {
      root.classList.add('density-comfortable')
      root.classList.remove('density-compact')
    }
    
    const timeout = setTimeout(() => {
      root.classList.remove('density-transitioning')
    }, 250)
    
    return () => clearTimeout(timeout)
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
