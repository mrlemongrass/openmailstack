type MediaQueryMatcher = (query: string) => Pick<MediaQueryList, 'matches'>;
type BookingFormTarget = Pick<HTMLFormElement, 'scrollIntoView' | 'focus'>;

export function transitionMobileBookingForm(
  bookingForm: BookingFormTarget | null,
  matchMedia: MediaQueryMatcher,
): boolean {
  if (!bookingForm || !matchMedia('(max-width: 680px)').matches) return false;

  bookingForm.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  bookingForm.focus({ preventScroll: true });
  return true;
}
