/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut, 
  sendPasswordResetEmail,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  orderBy,
  updateDoc,
  Timestamp
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Star, 
  Trophy, 
  LogOut, 
  User, 
  Shield, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  HelpCircle, 
  Lock, 
  ArrowLeft,
  Mail,
  Key,
  Gamepad2,
  Calendar,
  Users,
  History,
  AlertCircle,
  Info
} from 'lucide-react';
import { format, differenceInDays, addDays } from 'date-fns';
import { cn } from './lib/utils';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type UserStatus = 'trial' | 'liberado' | 'bloqueado' | 'solicitado';
type UserRole = 'user' | 'admin';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  createdAt: any;
  trialEndsAt?: any;
  firstLoginAt?: any;
  status: UserStatus;
  role: UserRole;
}

interface GameProgress {
  userId: string;
  world: number;
  stars: number;
  completed: boolean;
  lastPlayed: any;
}

interface LoginRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  timestamp: any;
}

// --- Constants ---

const ADMIN_EMAIL = 'patricioaug@gmail.com';

// --- Helpers ---

const playSound = (type: 'success' | 'error' | 'click' | 'complete') => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  if (type === 'success') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.1); // C6
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'error') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now); // A3
    osc.frequency.linearRampToValueAtTime(110, now + 0.2); // A2
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'click') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (type === 'complete') {
    // Arpeggio
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0.1, now + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
      o.start(now + i * 0.1);
      o.stop(now + i * 0.1 + 0.3);
    });
  }
};

const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.9; // Slightly slower for children
    window.speechSynthesis.cancel(); // Stop any current speech
    window.speechSynthesis.speak(utterance);
  }
};

// --- Components ---

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayError = "Ocorreu um erro inesperado.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayError = `Erro de Permissão: ${parsed.operationType} em ${parsed.path}`;
      } catch (e) {
        displayError = this.state.error.message || displayError;
      }

      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
          <Card className="max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-black text-gray-800 mb-2">Ops! Algo deu errado</h1>
            <p className="text-gray-600 mb-6">{displayError}</p>
            <Button onClick={() => window.location.reload()} className="w-full">Recarregar Página</Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: 'bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-200',
    secondary: 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-200',
    outline: 'border-2 border-orange-500 text-orange-500 hover:bg-orange-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };
  return (
    <button 
      className={cn('px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], className)} 
      {...props} 
    />
  );
};

const Input = ({ label, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) => (
  <div className="space-y-1 w-full">
    {label && <label className="text-sm font-semibold text-gray-700 ml-1">{label}</label>}
    <input 
      className={cn(
        "w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-orange-500 outline-none transition-all bg-gray-50",
        error && "border-red-500 focus:border-red-500"
      )} 
      {...props} 
    />
    {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
  </div>
);

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded-3xl p-8 shadow-xl border border-gray-100", className)}>
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [error, setError] = useState<string | null>(null);
  const [currentWorld, setCurrentWorld] = useState<number>(0); // 0 = Map, 1-4 = Worlds
  const [progress, setProgress] = useState<Record<number, GameProgress>>({});

  // Auth Listener
  useEffect(() => {
    let unsubProgress: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await fetchProfile(u.uid);
        unsubProgress = fetchProgress(u.uid);
      } else {
        if (unsubProgress) unsubProgress();
        setProfile(null);
        setProgress({});
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      if (unsubProgress) unsubProgress();
    };
  }, []);

  const fetchProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        let data = docSnap.data() as UserProfile;
        // Force admin role and status for the specific admin email
        if (data.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          data = { ...data, role: 'admin', status: 'liberado' };
        }
        setProfile(data);
      } else if (auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        // Create admin profile if it doesn't exist
        const newAdminProfile: UserProfile = {
          uid,
          name: 'Administrador',
          email: auth.currentUser.email!,
          createdAt: serverTimestamp(),
          status: 'liberado',
          role: 'admin'
        };
        await setDoc(docRef, newAdminProfile);
        setProfile(newAdminProfile);
      }
    } catch (err) {
      if (auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        console.warn("Admin profile fetch failed, attempting to create/recreate...");
        try {
          const docRef = doc(db, 'users', uid);
          const newAdminProfile: UserProfile = {
            uid,
            name: 'Administrador',
            email: auth.currentUser.email!,
            createdAt: serverTimestamp(),
            status: 'liberado',
            role: 'admin'
          };
          await setDoc(docRef, newAdminProfile);
          setProfile(newAdminProfile);
          return;
        } catch (createErr) {
          console.error("Failed to create admin profile:", createErr);
        }
      }
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }
  };

  const fetchProgress = (uid: string) => {
    const path = 'progress';
    const q = query(collection(db, path), where('userId', '==', uid));
    return onSnapshot(q, (snapshot) => {
      const p: Record<number, GameProgress> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data() as GameProgress;
        p[data.world] = data;
      });
      setProgress(p);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, path);
    });
  };

  const handleNotifyLogin = async (u: FirebaseUser, name: string) => {
    try {
      await fetch('/api/notify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: u.email,
          timestamp: new Date().toLocaleString('pt-BR')
        })
      });
      
      // Log to Firestore
      await addDoc(collection(db, 'logins'), {
        userId: u.uid,
        userName: name,
        userEmail: u.email,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Error notifying login:", err);
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const { user: u } = await signInWithEmailAndPassword(auth, email, password);
      // Profile will be fetched by the listener
      const docRef = doc(db, 'users', u.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const p = docSnap.data() as UserProfile;
        
        // Set trial ends at on first login if not already set
        if (!p.trialEndsAt) {
          const now = new Date();
          const trialEnds = addDays(now, 7);
          await updateDoc(docRef, {
            firstLoginAt: serverTimestamp(),
            trialEndsAt: Timestamp.fromDate(trialEnds)
          });
        }

        await handleNotifyLogin(u, p.name);
      }
    } catch (err: any) {
      setError("E-mail ou senha incorretos.");
    }
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const { user: u } = await createUserWithEmailAndPassword(auth, email, password);
      
      const now = new Date();
      const trialEnds = addDays(now, 7);
      const newProfile: UserProfile = {
        uid: u.uid,
        name,
        email,
        createdAt: serverTimestamp(),
        firstLoginAt: serverTimestamp(),
        trialEndsAt: Timestamp.fromDate(trialEnds),
        status: 'trial',
        role: email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user'
      };

      await setDoc(doc(db, 'users', u.uid), newProfile);
      setProfile(newProfile);
      await handleNotifyLogin(u, name);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError("Este e-mail já está cadastrado.");
      } else {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser?.uid || 'new'}`);
      }
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;

    try {
      await sendPasswordResetEmail(auth, email);
      alert("E-mail de recuperação enviado!");
      setAuthMode('login');
    } catch (err) {
      setError("Erro ao enviar e-mail. Verifique o endereço.");
    }
  };

  const isTrialExpired = useMemo(() => {
    if (!profile) return false;
    // Admin is always released
    const isAdminUser = profile.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() || profile.role === 'admin';
    if (isAdminUser) return false;
    if (profile.status === 'liberado') return false;
    if (profile.status === 'bloqueado') return true;
    if (profile.status === 'solicitado') return true;
    
    if (!profile.trialEndsAt) return false;
    const trialEnd = profile.trialEndsAt instanceof Timestamp ? profile.trialEndsAt.toDate() : new Date(profile.trialEndsAt);
    return new Date() > trialEnd;
  }, [profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4 font-sans">
        <Card className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-orange-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Gamepad2 className="w-10 h-10 text-orange-500" />
            </div>
            <h1 className="text-3xl font-black text-gray-800">Missão Som do S</h1>
            <p className="text-gray-500 font-medium">Descobrindo o jeito certo de escrever</p>
          </div>

          {authMode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Input name="email" type="email" label="E-mail" placeholder="seu@email.com" required />
              <Input name="password" type="password" label="Senha" placeholder="••••••••" required />
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <Button type="submit" className="w-full">Entrar</Button>
              <div className="flex flex-col gap-2 text-center mt-4">
                <button type="button" onClick={() => setAuthMode('signup')} className="text-sm text-blue-500 font-bold hover:underline">Criar nova conta</button>
                <button type="button" onClick={() => setAuthMode('forgot')} className="text-sm text-gray-400 hover:underline">Esqueci minha senha</button>
              </div>
            </form>
          )}

          {authMode === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <Input name="name" label="Nome da Criança" placeholder="Ex: Joãozinho" required />
              <Input name="email" type="email" label="E-mail do Responsável" placeholder="seu@email.com" required />
              <Input name="password" type="password" label="Senha" placeholder="Mínimo 6 caracteres" minLength={6} required />
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <Button type="submit" className="w-full">Cadastrar</Button>
              <button type="button" onClick={() => setAuthMode('login')} className="w-full text-sm text-gray-500 font-bold hover:underline mt-4">Já tenho uma conta</button>
            </form>
          )}

          {authMode === 'forgot' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <h2 className="text-xl font-bold text-gray-800 text-center">Recuperar Senha</h2>
              <p className="text-sm text-gray-500 text-center">Enviaremos um link para o seu e-mail.</p>
              <Input name="email" type="email" label="E-mail" placeholder="seu@email.com" required />
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <Button type="submit" className="w-full">Enviar Link</Button>
              <button type="button" onClick={() => setAuthMode('login')} className="w-full text-sm text-gray-500 font-bold hover:underline mt-4">Voltar para Login</button>
            </form>
          )}
        </Card>
      </div>
    );
  }

  const handleRequestAccess = async () => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), { status: 'solicitado' });
      setProfile({ ...profile, status: 'solicitado' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  if (isTrialExpired && profile?.role !== 'admin' && profile?.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-gray-800 mb-4">Acesso Bloqueado</h1>
          <p className="text-gray-600 mb-8">
            {profile?.status === 'solicitado' ? (
              <>Sua solicitação de acesso foi enviada! <br /> Aguarde a liberação pelo administrador.</>
            ) : (
              <>Seu período de avaliação terminou. <br /> Clique no botão abaixo para solicitar acesso ou entre em contato pelo e-mail <span className="font-bold text-blue-600">{ADMIN_EMAIL}</span>.</>
            )}
          </p>
          <div className="space-y-3">
            {profile?.status !== 'solicitado' && (
              <Button onClick={handleRequestAccess} className="w-full bg-orange-500 hover:bg-orange-600">
                Solicitar Acesso
              </Button>
            )}
            <Button variant="ghost" onClick={() => signOut(auth)} className="w-full">Sair da Conta</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50 font-sans pb-20">
      {/* Header */}
      <header className="bg-white px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white font-black">S</div>
          <h1 className="text-xl font-black text-gray-800 hidden sm:block">Missão Som do S</h1>
        </div>
        <div className="flex items-center gap-4">
          {(profile?.role === 'admin' || profile?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() || user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) && (
            <button 
              onClick={() => {
                console.log("Toggling admin panel");
                setCurrentWorld(prev => prev === -1 ? 0 : -1);
              }} 
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all", 
                currentWorld === -1 ? "bg-purple-600 text-white shadow-lg shadow-purple-200" : "text-gray-400 hover:bg-gray-100"
              )}
            >
              <Shield className="w-5 h-5" />
              <span className="hidden md:inline">ADMIN</span>
            </button>
          )}
          <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-xl">
            <User className="w-5 h-5 text-gray-500" />
            <span className="font-bold text-gray-700">{profile?.name}</span>
          </div>
          <button onClick={() => signOut(auth)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <AnimatePresence initial={false}>
          {currentWorld === -1 ? (
            <motion.div
              key="admin"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <AdminPanel onBack={() => setCurrentWorld(0)} />
            </motion.div>
          ) : currentWorld === 0 ? (
            <motion.div
              key="map"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3 }}
            >
              <GameMap onSelectWorld={setCurrentWorld} progress={progress} />
            </motion.div>
          ) : (
            <motion.div
              key={`world-${currentWorld}`}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <WorldView 
                worldId={currentWorld} 
                onBack={() => setCurrentWorld(0)} 
                onComplete={(stars) => {
                  // Save progress
                  const progressId = `${user.uid}_${currentWorld}`;
                  setDoc(doc(db, 'progress', progressId), {
                    userId: user.uid,
                    world: currentWorld,
                    stars: Math.max(stars, progress[currentWorld]?.stars || 0),
                    completed: true,
                    lastPlayed: serverTimestamp()
                  });
                  setCurrentWorld(0);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Game Map ---

function GameMap({ onSelectWorld, progress }: { onSelectWorld: (id: number) => void; progress: Record<number, GameProgress> }) {
  const worlds = [
    { id: 1, title: "O Som Misterioso", icon: "👂", color: "bg-green-500", desc: "Perceba que o som é igual!" },
    { id: 2, title: "Onde a Palavra Nasce", icon: "🌱", color: "bg-blue-500", desc: "Aprenda as regras visuais." },
    { id: 3, title: "O Sentido da Palavra", icon: "📖", color: "bg-purple-500", desc: "Use o significado para decidir." },
    { id: 4, title: "Desafios Rápidos", icon: "⚡", color: "bg-orange-500", desc: "Seja rápido e acerte tudo!" },
  ];

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-4xl font-black text-gray-800 mb-2">Escolha sua Missão!</h2>
        <p className="text-gray-500 font-medium">Ajude nosso robô a consertar o Mundo do Som S</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {worlds.map((w) => (
          <motion.button
            key={w.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectWorld(w.id)}
            className="bg-white p-6 rounded-3xl shadow-lg border-b-8 border-gray-100 flex items-center gap-6 text-left relative overflow-hidden group"
          >
            <div className={cn("w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shadow-inner", w.color)}>
              {w.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-black uppercase tracking-wider text-gray-400">Mundo {w.id}</span>
                {progress[w.id]?.completed && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              </div>
              <h3 className="text-xl font-black text-gray-800">{w.title}</h3>
              <p className="text-gray-500 text-sm font-medium">{w.desc}</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="flex">
                {[1, 2, 3].map(s => (
                  <Star key={s} className={cn("w-5 h-5", (progress[w.id]?.stars || 0) >= s ? "text-yellow-400 fill-yellow-400" : "text-gray-200")} />
                ))}
              </div>
              <ChevronRight className="w-6 h-6 text-gray-300 group-hover:text-orange-500 transition-colors" />
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// --- World View ---

function WorldView({ worldId, onBack, onComplete }: { worldId: number; onBack: () => void; onComplete: (stars: number) => void }) {
  const [step, setStep] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; msg: string } | null>(null);

  const worldsData: any = {
    1: {
      title: "O Som Misterioso",
      intro: "Bem-vindo! Aqui vamos descobrir que 'ss' e 'ç' podem ter o mesmo som. Ouça e observe!",
      steps: [
        { type: 'info', word1: 'paço', word2: 'passo', meaning1: 'Paço com Ç é um palácio onde vivem reis.', meaning2: 'Passo com SS é o movimento que fazemos ao caminhar.', msg: "Ouça: paço e passo. O som é o mesmo, mas o significado muda!", seed: 'palace' },
        { type: 'info', word1: 'caça', word2: 'cassa', meaning1: 'Caça com Ç é quando alguém persegue animais na floresta.', meaning2: 'Cassa com SS significa anular ou tirar a validade de algo.', msg: "Viu só? 'Caça' (animal) e 'Cassa' (anular) soam iguais!", seed: 'deer' },
        { type: 'info', word1: 'maça', word2: 'massa', meaning1: 'Maça com Ç é uma arma antiga, tipo um porrete com pontas.', meaning2: 'Massa com SS é o que usamos para fazer pizza ou pão.', msg: "Maça (arma antiga) e Massa (de pizza). Som igual, escrita diferente!", seed: 'pizza' },
        { type: 'info', word1: 'aço', word2: 'asso', meaning1: 'Aço com Ç é um metal muito forte usado em construções.', meaning2: 'Asso com SS vem de assar, como quando colocamos um bolo no forno.', msg: "Aço (metal) e Asso (do verbo assar). Som idêntico!", seed: 'metal' },
        { type: 'info', word1: 'roça', word2: 'rossa', meaning1: 'Roça com Ç é o campo, a fazenda, onde plantamos comida.', meaning2: 'Rossa com SS vem de roçar, que é passar de raspão em algo.', msg: "Roça (campo) e Rossa (do verbo roçar). Quase iguais!", seed: 'farm' },
        { type: 'info', word1: 'poço', word2: 'posso', meaning1: 'Poço com Ç é um buraco fundo na terra para pegar água.', meaning2: 'Posso com SS vem de poder, quando você tem permissão para algo.', msg: "Poço (de água) e Posso (verbo poder). Som igual!", seed: 'well' },
        { type: 'info', word1: 'laço', word2: 'lasso', meaning1: 'Laço com Ç é um nó bonito feito com fita.', meaning2: 'Lasso com SS significa que alguém está muito cansado ou fadigado.', msg: "Laço (fita) e Lasso (cansado). Som igual!", seed: 'ribbon' },
        { type: 'info', word1: 'ruço', word2: 'russo', meaning1: 'Ruço com Ç é algo que está ficando grisalho ou desbotado.', meaning2: 'Russo com SS é quem nasce na Rússia.', msg: "Ruço (grisalho) e Russo (da Rússia). Som igual!", seed: 'russia' },
        { type: 'info', word1: 'moça', word2: 'mossa', meaning1: 'Moça com Ç é uma menina ou mulher jovem.', meaning2: 'Mossa com SS é uma marca ou um pequeno amassado em algo.', msg: "Moça (garota) e Mossa (marca/amassado). Som igual!", seed: 'girl' },
        { type: 'info', word1: 'coça', word2: 'coxa', meaning1: 'Coça com Ç é o ato de esfregar a pele quando ela pinica.', meaning2: 'Coxa com X é a parte de cima da nossa perna.', msg: "Atenção: Coça (verbo coçar) e Coxa (parte da perna) têm sons diferentes!", seed: 'scratch' },
        { type: 'info', word1: 'caçador', word2: 'cassador', meaning1: 'Caçador com Ç é a pessoa que sai para caçar animais.', meaning2: 'Cassador com SS é quem anula um direito ou mandato.', msg: "Caçador (quem caça) e Cassador (quem anula).", seed: 'hunter' },
        { type: 'info', word1: 'abraço', word2: 'abrasso', meaning1: 'Abraço com Ç é quando apertamos alguém com carinho.', meaning2: 'Abrasso com SS não existe na nossa língua!', msg: "Abraço é com ç! Abrasso não existe.", seed: 'hug' },
        { type: 'info', word1: 'cabeça', word2: 'cabessa', meaning1: 'Cabeça com Ç é a parte do corpo onde fica o nosso cérebro.', meaning2: 'Cabessa com SS não existe, está escrito errado!', msg: "Cabeça é com ç! Cabessa não existe.", seed: 'head' },
        { type: 'info', word1: 'açúcar', word2: 'assúcar', meaning1: 'Açúcar com Ç é o que usamos para adoçar o suco ou o café.', meaning2: 'Assúcar com SS está errado, o certo é com Ç.', msg: "Açúcar é com ç! Assúcar não existe.", seed: 'sugar' },
        { type: 'info', word1: 'moça', word2: 'mossa', meaning1: 'Moça com Ç é uma jovem.', meaning2: 'Mossa com SS é um amassadinho.', msg: "Moça (garota) e Mossa (marca).", seed: 'girl' },
      ]
    },
    2: {
      title: "Onde a Palavra Nasce",
      intro: "Regras de ouro: 'ç' nunca começa palavra. 'ss' adora ficar entre vogais!",
      steps: [
        { type: 'quiz', word: 'pa_o', options: ['ç', 'ss'], correct: 'ç', msg: "'Paço' tem ç porque é um palácio!", meaning: 'Paço é um palácio luxuoso onde vivem reis e rainhas.', seed: 'palace' },
        { type: 'quiz', word: 'pe_oa', options: ['ç', 'ss'], correct: 'ss', msg: "'Pessoa' tem ss porque está entre duas vogais!", meaning: 'Pessoa é qualquer ser humano, como você, eu ou seus amigos.', seed: 'person' },
        { type: 'quiz', word: 'abra_o', options: ['ç', 'ss'], correct: 'ç', msg: "'Abraço' usa ç!", meaning: 'Abraço é um gesto de carinho onde envolvemos alguém com os braços.', seed: 'hug' },
        { type: 'quiz', word: 'mi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "'Missão' usa ss!", meaning: 'Missão é uma tarefa importante que alguém precisa realizar.', seed: 'rocket' },
        { type: 'quiz', word: 'cabe_a', options: ['ç', 'ss'], correct: 'ç', msg: "Cabeça!", meaning: 'Cabeça é a parte do corpo onde ficam os olhos, a boca e o cérebro.', seed: 'head' },
        { type: 'quiz', word: 'cla_e', options: ['ç', 'ss'], correct: 'ss', msg: "Classe!", meaning: 'Classe pode ser a sua sala de aula ou um grupo de coisas iguais.', seed: 'classroom' },
        { type: 'quiz', word: 'a_úcar', options: ['ç', 'ss'], correct: 'ç', msg: "Açúcar!", meaning: 'Açúcar é um pozinho doce que usamos para adoçar alimentos.', seed: 'sugar' },
        { type: 'quiz', word: 'profe_or', options: ['ç', 'ss'], correct: 'ss', msg: "Professor!", meaning: 'Professor é a pessoa que ensina coisas novas para os alunos.', seed: 'teacher' },
        { type: 'quiz', word: 'ma_ã', options: ['ç', 'ss'], correct: 'ç', msg: "Maçã!", meaning: 'Maçã é uma fruta redondinha, vermelha ou verde, muito saborosa.', seed: 'apple' },
        { type: 'quiz', word: 'pa_ado', options: ['ç', 'ss'], correct: 'ss', msg: "Passado!", meaning: 'Passado é tudo o que já aconteceu antes do dia de hoje.', seed: 'clock' },
      ]
    },
    3: {
      title: "O Sentido da Palavra",
      intro: "O significado manda! Escolha a palavra certa para a frase.",
      steps: [
        { type: 'choice', sentence: "Eu ____ a roupa com o ferro.", options: ['passo', 'paço'], correct: 'passo', msg: "'Passo' vem do verbo passar!", meanings: { 'passo': 'Passo aqui significa o ato de passar o ferro na roupa.', 'paço': 'Paço é um palácio, não combina com passar roupa!' }, seed: 'ironing' },
        { type: 'choice', sentence: "O ____ do rei é muito luxuoso.", options: ['passo', 'paço'], correct: 'paço', msg: "'Paço' é um palácio!", meanings: { 'passo': 'Passo é o movimento de caminhar, não é onde o rei mora.', 'paço': 'Paço é o nome dado aos palácios reais.' }, seed: 'castle' },
        { type: 'choice', sentence: "A ____ de modelar é divertida.", options: ['massa', 'maça'], correct: 'massa', msg: "'Massa' é a mistura!", meanings: { 'massa': 'Massa é uma mistura macia que usamos para modelar ou cozinhar.', 'maça': 'Maça é uma arma antiga, não serve para modelar.' }, seed: 'clay' },
        { type: 'choice', sentence: "O cavaleiro usava uma ____.", options: ['massa', 'maça'], correct: 'maça', msg: "'Maça' é uma arma antiga!", meanings: { 'massa': 'Massa é de comer ou modelar, cavaleiros não usam isso em batalhas.', 'maça': 'Maça é uma clava pesada usada por guerreiros antigamente.' }, seed: 'knight' },
        { type: 'choice', sentence: "Eu ____ a carne no forno.", options: ['asso', 'aço'], correct: 'asso', msg: "'Asso' do verbo assar!", meanings: { 'asso': 'Asso significa colocar algo no forno para cozinhar.', 'aço': 'Aço é um metal duro, não se coloca no forno para comer!' }, seed: 'oven' },
        { type: 'choice', sentence: "A espada é feita de ____.", options: ['asso', 'aço'], correct: 'aço', msg: "'Aço' é the metal!", meanings: { 'asso': 'Asso é cozinhar, espadas não são feitas de cozinhar.', 'aço': 'Aço é um metal muito resistente usado para fazer ferramentas e espadas.' }, seed: 'sword' },
      ]
    },
    4: {
      title: "Desafios Rápidos",
      intro: "Hora do show! Acerte o máximo que puder.",
      steps: [
        { type: 'quiz', word: 'a_úcar', options: ['ç', 'ss'], correct: 'ç', msg: "Açúcar!", seed: 'sugar' },
        { type: 'quiz', word: 'profe_or', options: ['ç', 'ss'], correct: 'ss', msg: "Professor!", seed: 'teacher' },
        { type: 'quiz', word: 'cabe_a', options: ['ç', 'ss'], correct: 'ç', msg: "Cabeça!", seed: 'head' },
        { type: 'quiz', word: 'cla_e', options: ['ç', 'ss'], correct: 'ss', msg: "Classe!", seed: 'classroom' },
        { type: 'quiz', word: 'a_ado', options: ['ç', 'ss'], correct: 'ss', msg: "Assado!", seed: 'roast' },
        { type: 'quiz', word: 'almo_o', options: ['ç', 'ss'], correct: 'ç', msg: "Almoço!", seed: 'lunch' },
        { type: 'quiz', word: 'ma_ã', options: ['ç', 'ss'], correct: 'ç', msg: "Maçã!", seed: 'apple' },
        { type: 'quiz', word: 'pa_ado', options: ['ç', 'ss'], correct: 'ss', msg: "Passado!", seed: 'clock' },
        { type: 'quiz', word: 'la_o', options: ['ç', 'ss'], correct: 'ç', msg: "Laço!", seed: 'ribbon' },
        { type: 'quiz', word: 'o_o', options: ['ç', 'ss'], correct: 'ss', msg: "Osso!", seed: 'bone' },
        { type: 'quiz', word: 'cal_a', options: ['ç', 'ss'], correct: 'ç', msg: "Calça!", seed: 'pants' },
        { type: 'quiz', word: 'no_o', options: ['ç', 'ss'], correct: 'ss', msg: "Nosso!", seed: 'group' },
        { type: 'quiz', word: 'pra_a', options: ['ç', 'ss'], correct: 'ç', msg: "Praça!", seed: 'square' },
        { type: 'quiz', word: 'di_e', options: ['ç', 'ss'], correct: 'ss', msg: "Disse!", seed: 'talk' },
        { type: 'quiz', word: 'pre_a', options: ['ç', 'ss'], correct: 'ss', msg: "Pressa!", seed: 'fast' },
        { type: 'quiz', word: 'mo_a', options: ['ç', 'ss'], correct: 'ç', msg: "Moça!", seed: 'girl' },
        { type: 'quiz', word: 'a_ado', options: ['ç', 'ss'], correct: 'ss', msg: "Assado!", seed: 'roast' },
        { type: 'quiz', word: 'almo_o', options: ['ç', 'ss'], correct: 'ç', msg: "Almoço!", seed: 'lunch' },
        { type: 'quiz', word: 'abra_o', options: ['ç', 'ss'], correct: 'ç', msg: "Abraço!", seed: 'hug' },
        { type: 'quiz', word: 'pe_oa', options: ['ç', 'ss'], correct: 'ss', msg: "Pessoa!", seed: 'person' },
        { type: 'quiz', word: 'do_e', options: ['ç', 'ss'], correct: 'ç', msg: "Doce!", seed: 'candy' },
        { type: 'quiz', word: 'i_o', options: ['ç', 'ss'], correct: 'ss', msg: "Isso!", seed: 'point' },
        { type: 'quiz', word: 'pe_a', options: ['ç', 'ss'], correct: 'ç', msg: "Peça!", seed: 'puzzle' },
        { type: 'quiz', word: 'pa_agem', options: ['ç', 'ss'], correct: 'ss', msg: "Passagem!", seed: 'ticket' },
        { type: 'quiz', word: 'cor_ação', options: ['ç', 'ss'], correct: 'ç', msg: "Coração!", seed: 'heart' },
        { type: 'quiz', word: 'fo_a', options: ['ç', 'ss'], correct: 'ss', msg: "Fossa!", seed: 'hole' },
        { type: 'quiz', word: 'for_a', options: ['ç', 'ss'], correct: 'ç', msg: "Força!", seed: 'muscle' },
        { type: 'quiz', word: 'ma_a', options: ['ç', 'ss'], correct: 'ss', msg: "Massa!", seed: 'dough' },
        { type: 'quiz', word: 'ta_a', options: ['ç', 'ss'], correct: 'ç', msg: "Taça!", seed: 'cup' },
        { type: 'quiz', word: 've_o', options: ['ç', 'ss'], correct: 'ss', msg: "Vesso!", seed: 'reverse' },
        { type: 'quiz', word: 'a_e_o', options: ['ç', 'ss'], correct: 'ss', msg: "Acesso!", seed: 'door' },
        { type: 'quiz', word: 'su_e_o', options: ['ç', 'ss'], correct: 'ss', msg: "Sucesso!", seed: 'trophy' },
        { type: 'quiz', word: 'pro_e_o', options: ['ç', 'ss'], correct: 'ss', msg: "Processo!", seed: 'paper' },
        { type: 'quiz', word: 'e_pe_a', options: ['ç', 'ss'], correct: 'ss', msg: "Espessa!", seed: 'thick' },
        { type: 'quiz', word: 're_e_o', options: ['ç', 'ss'], correct: 'ss', msg: "Recesso!", seed: 'holiday' },
        { type: 'quiz', word: 'agre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Agressão!", seed: 'fight' },
        { type: 'quiz', word: 'aten_ão', options: ['ç', 'ss'], correct: 'ç', msg: "Atenção!", seed: 'alert' },
        { type: 'quiz', word: 'can_ão', options: ['ç', 'ss'], correct: 'ç', msg: "Canção!", seed: 'music' },
        { type: 'quiz', word: 'di_u_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Discussão!", seed: 'talk' },
        { type: 'quiz', word: 'e_pe_áculo', options: ['ç', 'ss'], correct: 'ss', msg: "Espetáculo!", seed: 'theatre' },
        { type: 'quiz', word: 'mi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Missão!", seed: 'rocket' },
        { type: 'quiz', word: 'abra_o', options: ['ç', 'ss'], correct: 'ç', msg: "Abraço!", seed: 'hug' },
        { type: 'quiz', word: 'pe_oa', options: ['ç', 'ss'], correct: 'ss', msg: "Pessoa!", seed: 'person' },
        { type: 'quiz', word: 'do_e', options: ['ç', 'ss'], correct: 'ç', msg: "Doce!", seed: 'candy' },
        { type: 'quiz', word: 'i_o', options: ['ç', 'ss'], correct: 'ss', msg: "Isso!", seed: 'point' },
        { type: 'quiz', word: 'pe_a', options: ['ç', 'ss'], correct: 'ç', msg: "Peça!", seed: 'puzzle' },
        { type: 'quiz', word: 'pa_agem', options: ['ç', 'ss'], correct: 'ss', msg: "Passagem!", seed: 'ticket' },
        { type: 'quiz', word: 'cor_ação', options: ['ç', 'ss'], correct: 'ç', msg: "Coração!", seed: 'heart' },
        { type: 'quiz', word: 'fo_a', options: ['ç', 'ss'], correct: 'ss', msg: "Fossa!", seed: 'hole' },
        { type: 'quiz', word: 'for_a', options: ['ç', 'ss'], correct: 'ç', msg: "Força!", seed: 'muscle' },
        { type: 'quiz', word: 'a_unção', options: ['ç', 'ss'], correct: 'ss', msg: "Assunção!", seed: 'church' },
        { type: 'quiz', word: 're_urreição', options: ['ç', 'ss'], correct: 'ss', msg: "Ressurreição!", seed: 'life' },
        { type: 'quiz', word: 'e_pre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Expressão!", seed: 'face' },
        { type: 'quiz', word: 'impre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Impressão!", seed: 'printer' },
        { type: 'quiz', word: 'depre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Depressão!", seed: 'sad' },
        { type: 'quiz', word: 'compre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Compressão!", seed: 'squeeze' },
        { type: 'quiz', word: 'progre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Progressão!", seed: 'stairs' },
        { type: 'quiz', word: 'regre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Regressão!", seed: 'back' },
        { type: 'quiz', word: 'transgre_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Transgressão!", seed: 'rule' },
        { type: 'quiz', word: 'admi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Admissão!", seed: 'enter' },
        { type: 'quiz', word: 'demi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Demissão!", seed: 'exit' },
        { type: 'quiz', word: 'transmi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Transmissão!", seed: 'radio' },
        { type: 'quiz', word: 'permi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Permissão!", seed: 'key' },
        { type: 'quiz', word: 'comi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Comissão!", seed: 'group' },
        { type: 'quiz', word: 'omi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Omissão!", seed: 'hide' },
        { type: 'quiz', word: 'submi_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Submissão!", seed: 'bow' },
        { type: 'quiz', word: 'con_e_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Concessão!", seed: 'give' },
        { type: 'quiz', word: 'su_e_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Sucessão!", seed: 'line' },
        { type: 'quiz', word: 're_e_ão', options: ['ç', 'ss'], correct: 'ss', msg: "Recessão!", seed: 'money' },
      ]
    }
  };

  const data = worldsData[worldId];
  const currentStep = data.steps[step];

  const handleAnswer = (ans: string) => {
    if (feedback) return;
    const isCorrect = ans === currentStep.correct;
    if (isCorrect) {
      setScore(s => s + 1);
      playSound('success');
      speak("Muito bem!");
    } else {
      playSound('error');
      speak("Quase lá!");
    }
    setFeedback({ correct: isCorrect, msg: currentStep.msg });
  };

  const nextStep = () => {
    playSound('click');
    setFeedback(null);
    if (step < data.steps.length - 1) {
      setStep(s => s + 1);
    } else {
      playSound('complete');
      const stars = Math.ceil((score / data.steps.length) * 3);
      onComplete(stars || 3);
    }
  };

  // Speak on step change
  useEffect(() => {
    if (currentStep.type === 'info') {
      speak(`${currentStep.word1}... ${currentStep.word2}... ${currentStep.msg}`);
    } else if (currentStep.type === 'quiz' && !feedback) {
      speak(currentStep.word.replace('_', ' '));
    } else if (currentStep.type === 'choice' && !feedback) {
      speak(currentStep.sentence.replace('____', '...'));
    }
  }, [step, worldId]);

  return (
    <div className="max-w-2xl mx-auto px-2">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-400 font-bold mb-4 hover:text-gray-600 transition-colors">
        <ArrowLeft className="w-5 h-5" /> Voltar ao Mapa
      </button>

      <Card className="relative overflow-visible min-h-[600px] flex flex-col">
        <div className="absolute top-0 left-0 w-full h-2 bg-gray-100 rounded-t-3xl overflow-hidden">
          <motion.div 
            className="h-full bg-orange-500" 
            initial={{ width: 0 }}
            animate={{ width: `${((step + 1) / data.steps.length) * 100}%` }}
          />
        </div>

        <div className="mt-6 flex-1 flex flex-col">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-gray-800 mb-1">{data.title}</h2>
            <p className="text-gray-500 text-sm font-medium">{data.intro}</p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div 
              key={step}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col items-center justify-center text-center py-4"
            >
              {currentStep.type === 'info' && (
                <div className="space-y-6 w-full">
                  <div className="flex flex-wrap gap-4 justify-center">
                    <button 
                      onClick={() => { playSound('click'); speak(currentStep.meaning1 || currentStep.word1); }}
                      className="bg-blue-50 p-6 rounded-3xl border-4 border-blue-100 hover:bg-blue-100 transition-all active:scale-95 group"
                    >
                      <span className="text-4xl sm:text-5xl font-black text-blue-600 block">{currentStep.word1}</span>
                      <span className="text-xs font-bold text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Clique para saber o significado</span>
                    </button>
                    <button 
                      onClick={() => { playSound('click'); speak(currentStep.meaning2 || currentStep.word2); }}
                      className="bg-orange-50 p-6 rounded-3xl border-4 border-orange-100 hover:bg-orange-100 transition-all active:scale-95 group"
                    >
                      <span className="text-4xl sm:text-5xl font-black text-orange-600 block">{currentStep.word2}</span>
                      <span className="text-xs font-bold text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity">Clique para saber o significado</span>
                    </button>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-gray-700 px-4">{currentStep.msg}</p>
                  <Button onClick={nextStep} className="px-12 w-full sm:w-auto">Entendi!</Button>
                </div>
              )}

              {currentStep.type === 'quiz' && (
                <div className="space-y-8 w-full">
                  <button 
                    onClick={() => { playSound('click'); speak(currentStep.meaning || currentStep.word.replace('_', currentStep.correct)); }}
                    className="text-5xl sm:text-7xl font-black text-gray-800 tracking-widest hover:text-orange-500 transition-colors group relative"
                  >
                    {currentStep.word.split('_')[0]}
                    <span className="text-orange-500 border-b-4 border-orange-500 min-w-[60px] inline-block mx-2">
                      {feedback ? currentStep.correct : '?'}
                    </span>
                    {currentStep.word.split('_')[1]}
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs font-bold text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Clique para saber o significado</span>
                  </button>
                  
                  {!feedback ? (
                    <div className="flex gap-4 justify-center">
                      {currentStep.options.map((opt: string) => (
                        <Button key={opt} onClick={() => handleAnswer(opt)} className="text-3xl px-10 py-6">
                          {opt}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn("p-6 rounded-2xl space-y-4 w-full", feedback.correct ? "bg-green-50" : "bg-red-50")}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {feedback.correct ? <CheckCircle2 className="text-green-500" /> : <XCircle className="text-red-500" />}
                        <span className={cn("font-black text-xl", feedback.correct ? "text-green-600" : "text-red-600")}>
                          {feedback.correct ? "Muito bem!" : "Quase lá!"}
                        </span>
                      </div>
                      <p className="text-gray-700 font-medium">{feedback.msg}</p>
                      <Button onClick={nextStep} variant={feedback.correct ? "primary" : "secondary"} className="w-full sm:w-auto">Continuar</Button>
                    </motion.div>
                  )}
                </div>
              )}

              {currentStep.type === 'choice' && (
                <div className="space-y-8 w-full">
                  <button 
                    onClick={() => { playSound('click'); speak(currentStep.sentence.replace('____', feedback ? currentStep.correct : '...')); }}
                    className="text-2xl sm:text-3xl font-bold text-gray-800 leading-relaxed hover:text-blue-500 transition-colors px-4"
                  >
                    {currentStep.sentence.replace('____', feedback ? `[${currentStep.correct}]` : '____')}
                  </button>
                  
                  {!feedback ? (
                    <div className="flex flex-col gap-3 max-w-xs mx-auto w-full">
                      {currentStep.options.map((opt: string) => (
                        <div key={opt} className="flex gap-2 items-center">
                          <Button 
                            onClick={() => handleAnswer(opt)} 
                            variant="outline" 
                            className="flex-1 text-xl py-4"
                          >
                            {opt}
                          </Button>
                          <button 
                            onClick={() => speak(currentStep.meanings?.[opt] || opt)}
                            className="p-3 rounded-full bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors"
                            title="Ouvir significado"
                          >
                            <Info className="w-6 h-6" />
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-gray-400 mt-2 italic">Dica: Clique no ícone azul para ouvir o significado da palavra!</p>
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn("p-6 rounded-2xl space-y-4 w-full", feedback.correct ? "bg-green-50" : "bg-red-50")}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {feedback.correct ? <CheckCircle2 className="text-green-500" /> : <XCircle className="text-red-500" />}
                        <span className={cn("font-black text-xl", feedback.correct ? "text-green-600" : "text-red-600")}>
                          {feedback.correct ? "Excelente!" : "Ops!"}
                        </span>
                      </div>
                      <p className="text-gray-700 font-medium">{feedback.msg}</p>
                      <Button onClick={nextStep} variant={feedback.correct ? "primary" : "secondary"} className="w-full sm:w-auto">Próxima Frase</Button>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

// --- Admin Panel ---

function AdminPanel({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'logins'>('users');

  useEffect(() => {
    let usersLoaded = false;
    let loginsLoaded = false;

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
      usersLoaded = true;
      if (loginsLoaded) setLoading(false);
    }, (err) => {
      console.error("AdminPanel users error:", err);
      setLoading(false);
      // Don't throw here to avoid crashing the whole panel if one part fails
    });

    const unsubLogins = onSnapshot(query(collection(db, 'logins'), orderBy('timestamp', 'desc')), (snap) => {
      setLogins(snap.docs.map(d => ({ id: d.id, ...d.data() } as LoginRecord)));
      loginsLoaded = true;
      if (usersLoaded) setLoading(false);
    }, (err) => {
      console.error("AdminPanel logins error:", err);
      setLoading(false);
    });

    return () => { unsubUsers(); unsubLogins(); };
  }, []);

  const toggleUserStatus = async (uid: string, currentStatus: UserStatus, explicitNextStatus?: UserStatus) => {
    const nextStatus: UserStatus = explicitNextStatus || (currentStatus === 'liberado' ? 'bloqueado' : 'liberado');
    try {
      await updateDoc(doc(db, 'users', uid), { status: nextStatus });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 space-y-4">
      <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-500 font-bold">Carregando painel...</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-3xl font-black text-gray-800">Painel do Administrador</h2>
        </div>
        <div className="flex bg-white p-1 rounded-xl shadow-sm border">
          <button 
            onClick={() => setTab('users')} 
            className={cn("px-4 py-2 rounded-lg font-bold transition-all", tab === 'users' ? "bg-orange-500 text-white" : "text-gray-400")}
          >
            Usuários
          </button>
          <button 
            onClick={() => setTab('logins')} 
            className={cn("px-4 py-2 rounded-lg font-bold transition-all", tab === 'logins' ? "bg-orange-500 text-white" : "text-gray-400")}
          >
            Logins
          </button>
        </div>
      </div>

      {tab === 'users' ? (
        <div className="grid gap-4">
          {users.map(u => (
            <Card key={u.uid} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800">{u.name}</h3>
                <p className="text-sm text-gray-500">{u.email}</p>
                <div className="flex gap-4 mt-2">
                  <span className="text-xs font-bold text-gray-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Criado em: {u.createdAt ? format(u.createdAt.toDate(), 'dd/MM/yyyy') : '-'}
                  </span>
                  <span className="text-xs font-bold text-orange-400 flex items-center gap-1">
                    <Star className="w-3 h-3" /> Trial até: {u.trialEndsAt ? format(u.trialEndsAt.toDate(), 'dd/MM/yyyy') : '-'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "px-3 py-1 rounded-full text-xs font-black uppercase",
                  u.status === 'trial' ? "bg-blue-100 text-blue-600" :
                  u.status === 'solicitado' ? "bg-orange-100 text-orange-600 animate-pulse" :
                  u.status === 'liberado' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                )}>
                  {u.status}
                </span>
                {u.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase() && (
                  <div className="flex gap-2">
                    {u.status === 'solicitado' && (
                      <Button 
                        variant="secondary" 
                        onClick={() => toggleUserStatus(u.uid, u.status, 'bloqueado')}
                        className="text-xs py-2 px-4 bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        Recusar
                      </Button>
                    )}
                    <Button 
                      variant={u.status === 'liberado' ? 'danger' : 'secondary'} 
                      onClick={() => toggleUserStatus(u.uid, u.status)}
                      className="text-xs py-2 px-4"
                    >
                      {u.status === 'liberado' ? 'Bloquear' : 'Liberar'}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl overflow-hidden shadow-lg border">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">Usuário</th>
                <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">E-mail</th>
                <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">Data/Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logins.map(l => (
                <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-gray-700">{l.userName}</td>
                  <td className="px-6 py-4 text-gray-500">{l.userEmail}</td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {l.timestamp ? format(l.timestamp.toDate(), 'dd/MM/yyyy HH:mm:ss') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
