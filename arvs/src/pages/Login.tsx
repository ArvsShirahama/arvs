import { useState } from 'react';
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  IonIcon,
  useIonRouter,
} from '@ionic/react';
import { logoGoogle } from 'ionicons/icons';
import { useAuth } from '../hooks/useAuth';
import './Login.css';

const Login: React.FC = () => {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useIonRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <IonPage>
      <IonContent className="ion-padding login-page" scrollY={false}>
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
              disabled={loading}
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
            onClick={signInWithGoogle}
            className="auth-google-btn"
          >
            <IonIcon icon={logoGoogle} slot="start" />
            Continue with Google
          </IonButton>

          <div className="auth-footer">
            <IonText>
              Don&apos;t have an account?{' '}
              <a href="/signup" onClick={(e) => { e.preventDefault(); router.push('/signup', 'forward'); }}>
                Sign Up
              </a>
            </IonText>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Login;
