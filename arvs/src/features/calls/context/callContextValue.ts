import { createContext, useContext } from 'react';
import type { UseVideoCallReturn } from '../hooks/useVideoCall';

export const CallContext = createContext<UseVideoCallReturn | null>(null);

export const useCall = (): UseVideoCallReturn => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
