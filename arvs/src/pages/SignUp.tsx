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
import './SignUp.css';

const SignUp: React.FC = () => {
  const { signUp, signInWithGoogle } = useAuth();
  const router = useIonRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !username || !displayName || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores.');
      return;
    }

    setLoading(true);
    const { error: err } = await signUp(email, password, username, displayName);
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
      <IonContent className="ion-padding signup-page">
        <div className="auth-container">
          <div className="auth-header">
            <h1 className="auth-title">Arvs</h1>
            <p className="auth-subtitle">Create your account</p>
          </div>

          <form onSubmit={handleSignUp} className="auth-form">
            <IonInput
              type="text"
              label="Display Name"
              labelPlacement="floating"
              fill="outline"
              value={displayName}
              onIonInput={(e) => setDisplayName(e.detail.value ?? '')}
              className="auth-input"
            />
            <IonInput
              type="text"
              label="Username"
              labelPlacement="floating"
              fill="outline"
              value={username}
              onIonInput={(e) => setUsername(e.detail.value ?? '')}
              className="auth-input"
              helperText="Letters, numbers, and underscores only"
            />
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
            <IonInput
              type="password"
              label="Confirm Password"
              labelPlacement="floating"
              fill="outline"
              value={confirmPassword}
              onIonInput={(e) => setConfirmPassword(e.detail.value ?? '')}
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
              {loading ? <IonSpinner name="crescent" /> : 'Create Account'}
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
              Already have an account?{' '}
              <a href="/login" onClick={(e) => { e.preventDefault(); router.push('/login', 'back'); }}>
                Sign In
              </a>
            </IonText>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SignUp;
