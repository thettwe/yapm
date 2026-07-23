import type { ConnectionState } from '@rocicorp/zero'
import { useConnectionState } from '@rocicorp/zero/react'

export interface ConnectionSummary {
  state: ConnectionState['name']
  label: string
  writable: boolean
  detail?: string
}

export function summarizeConnection(state: ConnectionState): ConnectionSummary {
  switch (state.name) {
    case 'connected':
      return { state: state.name, label: 'Connected', writable: true }
    case 'connecting':
      return {
        state: state.name,
        label: 'Connecting',
        writable: true,
        ...(state.reason === undefined ? {} : { detail: state.reason }),
      }
    case 'disconnected':
      return { state: state.name, label: 'Offline', writable: false, detail: state.reason }
    case 'needs-auth':
      return { state: state.name, label: 'Session expired', writable: false }
    case 'error':
      return { state: state.name, label: 'Sync error', writable: false, detail: state.reason }
    case 'closed':
      return { state: state.name, label: 'Closed', writable: false, detail: state.reason }
  }
}

export function useConnectionSummary(): ConnectionSummary {
  return summarizeConnection(useConnectionState())
}
