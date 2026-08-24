export interface AccountInterval {
  profileId?: string | null;
  accountAddress?: string | null;
  from: string;
  until?: string | null;
}

export class AttributionService {
  private readonly intervals: AccountInterval[] = [];

  open(profileId: string | null, accountAddress: string | null, from: string): void {
    const current = this.intervals.at(-1);
    if (current && !current.until) current.until = from;
    this.intervals.push({ profileId, accountAddress, from });
  }

  close(at: string): void {
    const current = this.intervals.at(-1);
    if (current && !current.until) current.until = at;
  }

  restore(intervals: readonly AccountInterval[]): void {
    this.intervals.length = 0;
    this.intervals.push(...intervals.map((interval) => ({ ...interval })));
  }

  resolve(timestamp: string): AccountInterval | undefined {
    return this.intervals.find(
      (interval) => interval.from <= timestamp && (!interval.until || timestamp < interval.until),
    );
  }

  list(): readonly AccountInterval[] {
    return this.intervals.map((interval) => ({ ...interval }));
  }
}
