export interface EventDetail {
  usual_effect: string;
  frequency: string;
  next_release: string;
}

export interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  actual: string;
  forecast: string;
  previous: string;
  detail: EventDetail | null;
}

export interface EmbeddedEvent {
  name: string;
  currency: string;
  dateline: number;
  actual: string;
  forecast: string;
  previous: string;
  impactTitle: string;
  soloUrl: string;
}
