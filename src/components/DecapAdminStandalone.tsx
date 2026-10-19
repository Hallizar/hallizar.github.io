import { useState, useEffect } from 'react';
import {
  Github,
  Key,
  ShieldCheck,
  ExternalLink,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';

export function DecapAdminStandalone() {
  const [githubToken, setGithubToken] = useState<string>('');
  const [showToken, setShowToken] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [savedTokenPreview, setSavedTokenPreview] = useState('');
  const [userInfo, setUserInfo] = useState<{ login?: string; avatar_url?: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Check stored Decap CMS GitHub session on mount
  useEffect(() => {
    document.title = 'Админ-панель Decap CMS | GitHub';

    // Очистка устаревшей сессии Netlify Identity (вход только через токен)
    localStorage.removeItem('netlify-cms-user');

    const checkStoredAuth = () => {
      const stored = localStorage.getItem('decap-cms-user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.token) {
            setIsLoggedIn(true);
            setSavedTokenPreview(parsed.token.slice(0, 4) + '...' + parsed.token.slice(-4));
            fetchGitHubUser(parsed.token);
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }
      setIsLoggedIn(false);
    };

    checkStoredAuth();
  }, []);

  const fetchGitHubUser = async (token: string) => {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (res.ok) {
        const user = await res.json();
        setUserInfo(user);
      }
    } catch (e) {
      console.warn('Could not fetch user details from GitHub', e);
    }
  };

  const handleSaveToken = (tokenToSave: string) => {
    const trimmed = tokenToSave.trim();
    if (!trimmed) {
      setErrorMsg('Пожалуйста, введите токен GitHub');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    // Test token with GitHub API
    fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${trimmed}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Токен недействителен или не имеет доступа к GitHub API');
        }
        const user = await res.json();
        setUserInfo(user);

        const sessionObj = { token: trimmed, backendName: 'github' };
        localStorage.setItem('decap-cms-user', JSON.stringify(sessionObj));
        setIsLoggedIn(true);
        setSavedTokenPreview(trimmed.slice(0, 4) + '...' + trimmed.slice(-4));
        setGithubToken('');
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Ошибка проверки токена');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleLogout = () => {
    localStorage.removeItem('decap-cms-user');
    localStorage.removeItem('netlify-cms-user');
    setIsLoggedIn(false);
    setUserInfo(null);
    setSavedTokenPreview('');
  };

  return (
    <div className="min-h-[85vh] bg-[#08080c] text-[#e0e0e6] flex flex-col justify-center items-center p-4 sm:p-6 font-mono text-xs">
      <div className="max-w-xl w-full p-6 sm:p-8 border border-[#2b2b38] bg-[#0c0c14] rounded-lg shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#20202c]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#161622] border border-[#303044] rounded-md flex items-center justify-center text-white shadow-md">
              <Github size={22} />
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#00ff9d] tracking-wider uppercase flex items-center gap-1.5">
                <ShieldCheck size={12} />
                 kek Backend &middot; Decap CMS
              </div>
              <h1 className="text-base sm:text-lg font-bold font-sans text-white">
                Панель управления контентом
              </h1>
            </div>
          </div>

          <div className="text-right text-[10px] text-[#777]">
            <span className="block text-[#a0a0b0] font-bold">heh</span>
            <span>ветка main</span>
          </div>
        </div>

        {/* ALREADY LOGGED IN VIEW */}
        {isLoggedIn ? (
          <div className="space-y-5">
            <div className="p-4 bg-[#0a1410] border border-[#1a3828] rounded-md flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {userInfo?.avatar_url ? (
                  <img
                    src={userInfo.avatar_url}
                    alt={userInfo.login || 'Avatar'}
                    className="w-10 h-10 rounded-full border border-(--success)/40 object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#112218] border border-(--success)/40 flex items-center justify-center text-[#00ff9d]">
                    <CheckCircle2 size={20} />
                  </div>
                )}
                <div>
                  <div className="text-white font-bold flex items-center gap-2">
                    {userInfo?.name || userInfo?.login || 'GitHub Пользователь'}
                    {userInfo?.login && (
                      <span className="text-[10px] text-[#00ff9d] font-normal">@{userInfo.login}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#70a080]">
                    Токен: <code className="text-[#a0e0c0]">{savedTokenPreview}</code> (достуg подтверждён)
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="px-3 py-1.5 border border-[#3d2028] bg-[#1a0e14] text-[#ff7090] hover:bg-[#2c121e] hover:border-[#ff4070] transition-colors text-[11px] font-bold flex items-center gap-1.5 cursor-pointer rounded"
                title="Выйти и сменить токен"
              >
                <LogOut size={13} />
                Выйти
              </button>
            </div>

            <p className="text-[#9999a4] text-xs leading-relaxed">
              Вы успешно авторизованы. 
            </p>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <a
                href="/admin/"
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-3 px-4 bg-[#8a00ff] hover:bg-[#9d1aff] text-white font-bold rounded flex items-center justify-center gap-2 transition-all shadow-lg text-xs"
              >
                <span>ОТКРЫТЬ DECAP CMS В НОВОЙ ВКЛАДКЕ</span>
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        ) : (
          /* NOT LOGGED IN: TOKEN-ONLY LOGIN */
          <div className="space-y-6">
            {errorMsg && (
              <div className="p-3 bg-[#1e0a12] border border-[#4a1828] text-[#ff6685] rounded flex items-start gap-2.5 text-xs">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <p className="text-[#9595a4] text-xs leading-relaxed">
              Авторизация в Decap CMS работает напрямую через <strong>heh</strong> (nheh отключен). Единственный способ входа — <strong>PAT</strong>:
            </p>

            {/* Login by Personal Access Token (PAT) — the only method */}
            <div className="p-4 bg-[#0a0a10] border border-[#222232] rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold flex items-center gap-2">
                  <Key size={14} className="text-[#bd5aff]" />
                  Вход по PAT
                </span>
              </div>

              <p className="text-[#777786] text-[11px] leading-relaxed">HEH<code>KEK</code>.
              </p>

              <div className="space-y-2">
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    className="w-full bg-[#050508] border border-[#303042] px-3 py-2 pr-10 text-white font-mono text-xs focus:border-[#8a00ff] outline-none rounded"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777] hover:text-white"
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=Hallizar+Blog+CMS"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#bd5aff] hover:underline flex items-center gap-1"
                  >
                    <span>Создать токен на KEK</span>
                    <ExternalLink size={10} />
                  </a>

                  <button
                    type="button"
                    disabled={!githubToken.trim() || loading}
                    onClick={() => handleSaveToken(githubToken)}
                    className="px-4 py-1.5 bg-[#8a00ff] hover:bg-[#9d1aff] disabled:bg-[#333] text-white font-bold rounded cursor-pointer transition-colors"
                  >
                    {loading ? 'Проверка...' : 'Войти с токеном'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-4 border-t border-[#1c1c28] flex items-center justify-between text-[10px] text-[#666]">
          <span>Платформа: Hallizar Blog Engine</span>
          <a href="/" className="text-[#bd5aff] hover:underline">
            &larr; Вернуться на главную
          </a>
        </div>
      </div>
    </div>
  );
}
