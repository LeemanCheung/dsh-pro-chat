export interface RefreshSelectionTicket {
  epoch: number
  preferredId: string | undefined
}

/**
 * Coordinates the imperative selection used by async handlers. A selection is
 * committed only after its detail request succeeds; beginning any user
 * mutation invalidates refreshes that were already in flight.
 */
export class RefreshSelectionCoordinator {
  private epoch = 0
  private committedId: string | undefined

  constructor(initialId?: string) {
    this.committedId = initialId
  }

  get selectedId(): string | undefined {
    return this.committedId
  }

  beginRefresh(preferredId = this.committedId): RefreshSelectionTicket {
    return { epoch: ++this.epoch, preferredId }
  }

  ownsRefresh(ticket: RefreshSelectionTicket): boolean {
    return ticket.epoch === this.epoch && ticket.preferredId === this.committedId
  }

  commitRefresh(ticket: RefreshSelectionTicket, selectedId: string | undefined): boolean {
    if (!this.ownsRefresh(ticket)) return false
    this.committedId = selectedId
    return true
  }

  beginMutation(): number {
    return ++this.epoch
  }

  ownsMutation(epoch: number): boolean {
    return epoch === this.epoch
  }

  commitMutation(epoch: number, selectedId: string | undefined): boolean {
    if (!this.ownsMutation(epoch)) return false
    this.committedId = selectedId
    return true
  }
}
