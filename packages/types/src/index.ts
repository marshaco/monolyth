// Types for the FastAPI backend, generated from packages/types/openapi.json.
// Regenerate after changing an API route or schema — see packages/types/README.md.
import type { components, operations, paths } from './api'

export type { components, operations, paths }

type Schemas = components['schemas']

export type Holding = Schemas['HoldingOut']
export type HoldingCreate = Schemas['HoldingIn']
export type FilingSummary = Schemas['FilingOut']
