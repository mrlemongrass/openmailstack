import { createContext } from 'react';
export const PolicyDraftContext = createContext<{ setState: (state: { dirty: boolean; busy: boolean }) => void; routeBlocked: boolean }>({ setState: () => {}, routeBlocked: false });
