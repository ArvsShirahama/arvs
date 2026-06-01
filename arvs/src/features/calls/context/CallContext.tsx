import React, { createContext, useContext } from 'react';
import { useVideoCall, UseVideoCallReturn } from '../hooks/useVideoCall';

const CallContext = createContext<UseVideoCallReturn | null>(null);

interface CallProviderProps {
  localUserId: string | undefined;
  children: React.ReactNode;
}

export const CallProvider: React.FC<CallProviderProps> = ({
  localUserId,
  children,
}) => {
  const videoCall = useVideoCall(localUserId);

  return (
    <CallContext.Provider value={videoCall}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = (): UseVideoCallReturn => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
