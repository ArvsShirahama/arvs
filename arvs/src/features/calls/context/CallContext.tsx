import React from 'react';
import { useVideoCall } from '../hooks/useVideoCall';
import { CallContext } from './callContextValue';

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
