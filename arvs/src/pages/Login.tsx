import { useState } from 'react';
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
} from '@ionic/react';
import { useAuth } from '../hooks/useAuth';
import GoogleLogo from '../components/GoogleLogo';
import './Auth.css';
import './Login.css';

const Login: React.FC = () => {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useIonRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    const { error: err } = await signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      router.push('/tabs/chats', 'root', 'replace');
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    const { error: googleError } = await signInWithGoogle();
    setGoogleLoading(false);
    if (googleError) setError(googleError);
  };

  return (
    <IonPage>
      <IonContent className="ion-padding login-page">
        <div className="auth-container">
          <div className="auth-header">
            <h1 className="auth-title">Arvs</h1>
            <p className="auth-subtitle">Sign in to continue</p>
          </div>

          <form onSubmit={handleLogin} className="auth-form">
            <IonInput
              type="email"
              label="Email"
              labelPlacement="floating"
              fill="outline"
              value={email}
              onIonInput={(e) => setEmail(e.detail.value ?? '')}
              className="auth-input"
            />
            <IonInput
              type="password"
              label="Password"
              labelPlacement="floating"
              fill="outline"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
              className="auth-input"
            />

            {error && (
              <IonText color="danger" className="auth-error">
                <p>{error}</p>
              </IonText>
            )}

            <IonButton
              expand="block"
              type="submit"
              disabled={loading || googleLoading}
              className="auth-button"
            >
              {loading ? <IonSpinner name="crescent" /> : 'Sign In'}
            </IonButton>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <IonButton
            expand="block"
            fill="outline"
            onClick={handleGoogleSignIn}
            disabled={loading || googleLoading}
            className="auth-google-btn"
          >
            {googleLoading ? <IonSpinner name="crescent" /> : (
              <>
                <GoogleLogo />
                Continue with Google
              </>
            )}
          </IonButton>

          <div className="auth-footer">
            <IonText>
              Don&apos;t have an account?{' '}
              <span
                onClick={() => router.push('/signup', 'forward')}
                style={{ color: 'var(--ion-color-primary)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Sign Up
              </span>
            </IonText>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
