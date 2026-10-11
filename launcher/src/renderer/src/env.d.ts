/// <reference types="vite/client" />
import type { Api } from '@shared/types'

declare global {
  interface Window {
    skate: Api
  }
}
