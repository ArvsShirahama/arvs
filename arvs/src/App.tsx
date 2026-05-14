import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonRouterOutlet,
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
  IonSpinner,
  setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { chatbubblesOutline, personOutline } from 'ionicons/icons';
import { useAuth } from './hooks/useAuth';

import PushNotificationManager from './components/PushNotificationManager';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import ChatList from './pages/ChatList';
import Chat from './pages/Chat';
import ConversationSettings from './pages/ConversationSettings';
import ConversationMedia from './pages/ConversationMedia';
import Profile from './pages/Profile';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

const App: React.FC = () => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <IonApp>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <IonSpinner name="crescent" />
        </div>
      </IonApp>
    );
  }

  return (
    <IonApp>
      <IonReactRouter>
        <PushNotificationManager />
        <IonRouterOutlet>
          {/* Auth routes */}
          <Route exact path="/login">
            {session ? <Redirect to="/tabs/chats" /> : <Login />}
          </Route>
          <Route exact path="/signup">
            {session ? <Redirect to="/tabs/chats" /> : <SignUp />}
          </Route>

          {/* Chat detail (outside tabs so tab bar is hidden) */}
          <Route exact path="/chat/:conversationId">
            {session ? <Chat /> : <Redirect to="/login" />}
          </Route>
          <Route exact path="/chat/:conversationId/settings">
            {session ? <ConversationSettings /> : <Redirect to="/login" />}
          </Route>
          <Route exact path="/chat/:conversationId/media">
            {session ? <ConversationMedia /> : <Redirect to="/login" />}
          </Route>

          {/* Tab routes */}
          <Route path="/tabs">
            {session ? (
              <IonTabs>
                <IonRouterOutlet>
                  <Route exact path="/tabs/chats" component={ChatList} />
                  <Route exact path="/tabs/profile" component={Profile} />
                  <Redirect exact from="/tabs" to="/tabs/chats" />
                </IonRouterOutlet>
                <IonTabBar slot="bottom">
                  <IonTabButton tab="chats" href="/tabs/chats">
                    <IonIcon icon={chatbubblesOutline} />
                    <IonLabel>Chats</IonLabel>
                  </IonTabButton>
                  <IonTabButton tab="profile" href="/tabs/profile">
                    <IonIcon icon={personOutline} />
                    <IonLabel>Profile</IonLabel>
                  </IonTabButton>
                </IonTabBar>
              </IonTabs>
            ) : (
              <Redirect to="/login" />
            )}
          </Route>

          {/* Default redirect */}
          <Route exact path="/">
            <Redirect to={session ? '/tabs/chats' : '/login'} />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
