import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface WorkspaceTable {
  id: string
  name: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface DB {
  workspace: WorkspaceTable
}

export type Workspace = Selectable<WorkspaceTable>
export type NewWorkspace = Insertable<WorkspaceTable>
export type WorkspaceUpdate = Updateable<WorkspaceTable>
