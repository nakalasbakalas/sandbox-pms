import { useState, useCallback } from 'react'
import { toast } from 'sonner'

export interface UndoableAction<T = any> {
  type: string
  description: string
  undo: () => void
  redo: () => void
  timestamp: Date
  data?: T
}

interface UndoState {
  past: UndoableAction[]
  future: UndoableAction[]
}

export function useUndo(maxHistory: number = 50) {
  const [state, setState] = useState<UndoState>({
    past: [],
    future: []
  })

  const execute = useCallback((action: UndoableAction) => {
    action.redo()
    
    setState(prev => ({
      past: [...prev.past.slice(-maxHistory + 1), action],
      future: []
    }))
    
    return action
  }, [maxHistory])

  const undo = useCallback(() => {
    if (state.past.length === 0) {
      toast.error('Nothing to undo')
      return
    }

    const action = state.past[state.past.length - 1]
    action.undo()
    
    setState(prev => ({
      past: prev.past.slice(0, -1),
      future: [action, ...prev.future]
    }))
    
    toast.success(`Undone: ${action.description}`)
  }, [state.past])

  const redo = useCallback(() => {
    if (state.future.length === 0) {
      toast.error('Nothing to redo')
      return
    }

    const action = state.future[0]
    action.redo()
    
    setState(prev => ({
      past: [...prev.past, action],
      future: prev.future.slice(1)
    }))
    
    toast.success(`Redone: ${action.description}`)
  }, [state.future])

  const canUndo = state.past.length > 0
  const canRedo = state.future.length > 0

  const clear = useCallback(() => {
    setState({ past: [], future: [] })
  }, [])

  return {
    execute,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    historySize: state.past.length
  }
}
