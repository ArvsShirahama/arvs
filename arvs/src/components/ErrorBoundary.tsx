import React, { Component, ErrorInfo, ReactNode } from 'react';
import { IonContent, IonText, IonButton, IonIcon } from '@ionic/react';
import { refreshOutline } from 'ionicons/icons';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component for gracefully handling React component errors
 * Wraps components and displays a fallback UI when errors occur
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <IonContent className="ion-padding">
          <div style={{ textAlign: 'center', paddingTop: '20%' }}>
            <IonText color="danger">
              <h2>Something went wrong</h2>
              <p>We're sorry, but something unexpected happened.</p>
            </IonText>
            <IonButton onClick={this.handleReset} expand="block" style={{ marginTop: '20px' }}>
              <IonIcon icon={refreshOutline} slot="start" />
              Try Again
            </IonButton>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details style={{ marginTop: '20px', textAlign: 'left' }}>
                <summary>Error Details (Development Only)</summary>
                <pre style={{ fontSize: '12px', overflow: 'auto', marginTop: '10px' }}>
                  {this.state.error.message}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </IonContent>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
