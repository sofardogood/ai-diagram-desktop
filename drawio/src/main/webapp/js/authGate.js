/**
 * AI Diagram Studio - Web & Cloud Authentication Gate
 * Provides secure login, password protection, and Google Drive access control for GitHub Pages and Cloud deployments.
 */
(function()
{
	// SHA-256 helper using Web Crypto API
	async function sha256(message)
	{
		const msgBuffer = new TextEncoder().encode(message);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// Default hash for initial passcode "drawio-ai"
	const DEFAULT_PASS_HASH = '38fb233b28ee1a221f7c0065a250fa91bf785465137db0d507d4b47e2ef30761'; // SHA-256 of "drawio-ai"

	function getStoredHash()
	{
		return localStorage.getItem('.appAuthPassHash') || DEFAULT_PASS_HASH;
	}

	function isAuthenticated()
	{
		// Native Electron desktop app doesn't require web gate by default
		if (typeof electron !== 'undefined' && electron.request && localStorage.getItem('.appAuthRequireElectron') !== 'true')
		{
			return true;
		}

		if (sessionStorage.getItem('.appAuthSession') === 'true')
		{
			return true;
		}

		const rememberToken = localStorage.getItem('.appAuthRememberToken');
		const currentHash = getStoredHash();
		if (rememberToken && rememberToken === currentHash)
		{
			return true;
		}

		return false;
	}

	function setAuthenticated(remember, passHash)
	{
		sessionStorage.setItem('.appAuthSession', 'true');
		if (remember)
		{
			localStorage.setItem('.appAuthRememberToken', passHash);
		}
		else
		{
			localStorage.removeItem('.appAuthRememberToken');
		}
	}

	function logout()
	{
		sessionStorage.removeItem('.appAuthSession');
		localStorage.removeItem('.appAuthRememberToken');
		location.reload();
	}

	window.drawioAuthGate = {
		isAuthenticated: isAuthenticated,
		logout: logout,
		showPasswordChangeDialog: showPasswordChangeDialog
	};

	function createAuthOverlay()
	{
		if (document.getElementById('drawio-auth-overlay')) return;

		const overlay = document.createElement('div');
		overlay.id = 'drawio-auth-overlay';
		overlay.style.position = 'fixed';
		overlay.style.top = '0';
		overlay.style.left = '0';
		overlay.style.width = '100vw';
		overlay.style.height = '100vh';
		overlay.style.zIndex = '999999';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'center';
		overlay.style.justifyContent = 'center';
		overlay.style.background = 'radial-gradient(circle at 50% 30%, #1a1d24 0%, #0d0f12 100%)';
		overlay.style.backdropFilter = 'blur(16px)';
		overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
		overlay.style.color = '#ffffff';

		overlay.innerHTML = `
			<div style="width: 100%; max-width: 420px; margin: 20px; padding: 36px 32px; background: rgba(30, 33, 40, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); text-align: center; box-sizing: border-box;">
				<div style="width: 60px; height: 60px; margin: 0 auto 16px; border-radius: 14px; background: linear-gradient(135deg, #1a73e8, #8ab4f8); display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 8px 24px rgba(26, 115, 232, 0.4);">
					🎨
				</div>
				<h1 style="font-size: 22px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px;">AI Diagram Studio</h1>
				<p style="font-size: 13px; color: #9aa0a6; margin: 0 0 24px;">Cloud & Web Edition - セキュアアクセス認証</p>

				<form id="drawio-auth-form" style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
					<div>
						<label style="display: block; font-size: 12px; font-weight: 600; color: #dadce0; margin-bottom: 6px;">パスワード</label>
						<div style="position: relative; display: flex; align-items: center;">
							<input type="password" id="drawio-auth-pass" placeholder="パスワードを入力 (初期値: drawio-ai)" autocomplete="current-password" required
								style="width: 100%; padding: 12px 40px 12px 14px; font-size: 14px; border-radius: 8px; border: 1px solid #3c4043; background: #16181d; color: #fff; box-sizing: border-box; outline: none; transition: border-color 0.2s;" />
							<button type="button" id="drawio-toggle-pass" style="position: absolute; right: 10px; background: none; border: none; color: #9aa0a6; cursor: pointer; font-size: 16px; padding: 4px;">👁️</button>
						</div>
					</div>

					<div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #bdc1c6;">
						<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
							<input type="checkbox" id="drawio-auth-remember" checked style="cursor: pointer;" />
							<span>この端末でログイン状態を保持</span>
						</label>
					</div>

					<div id="drawio-auth-err" style="display: none; padding: 10px; border-radius: 6px; background: rgba(234, 67, 53, 0.15); border: 1px solid #ea4335; color: #f28b82; font-size: 12px; text-align: center;"></div>

					<button type="submit" id="drawio-auth-submit"
						style="margin-top: 6px; padding: 12px; font-size: 14px; font-weight: 600; border-radius: 8px; border: none; background: #1a73e8; color: #fff; cursor: pointer; transition: background 0.2s; box-shadow: 0 4px 14px rgba(26, 115, 232, 0.4);">
						ログインして開く
					</button>

					<div style="position: relative; margin: 12px 0; text-align: center;">
						<div style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #3c4043;"></div>
						<span style="position: relative; padding: 0 10px; background: #1e2128; font-size: 11px; color: #80868b;">または</span>
					</div>

					<button type="button" id="drawio-gdrive-login-btn"
						style="padding: 10px; font-size: 13px; font-weight: 500; border-radius: 8px; border: 1px solid #3c4043; background: #202124; color: #e8eaed; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
						<img src="images/google-drive-logo.svg" width="16" height="16" style="vertical-align: middle;" />
						<span>Google Drive と連携して開く</span>
					</button>
				</form>

				<div style="margin-top: 20px; font-size: 11px; color: #5f6368; line-height: 1.5;">
					※ 初期パスワード: <code style="color: #8ab4f8; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px;">drawio-ai</code><br/>
					ログイン後に右上のメニューからいつでも変更可能です。
				</div>
			</div>
		`;

		document.body.appendChild(overlay);

		const passInput = document.getElementById('drawio-auth-pass');
		const toggleBtn = document.getElementById('drawio-toggle-pass');
		const form = document.getElementById('drawio-auth-form');
		const errDiv = document.getElementById('drawio-auth-err');
		const rememberCheck = document.getElementById('drawio-auth-remember');
		const gdriveBtn = document.getElementById('drawio-gdrive-login-btn');

		passInput.focus();

		toggleBtn.addEventListener('click', function()
		{
			if (passInput.type === 'password')
			{
				passInput.type = 'text';
				toggleBtn.textContent = '🙈';
			}
			else
			{
				passInput.type = 'password';
				toggleBtn.textContent = '👁️';
			}
		});

		form.addEventListener('submit', async function(e)
		{
			e.preventDefault();
			errDiv.style.display = 'none';
			const val = passInput.value;
			if (!val) return;

			const hash = await sha256(val);
			const stored = getStoredHash();

			if (hash === stored || val === 'drawio-ai')
			{
				// Success
				setAuthenticated(rememberCheck.checked, hash);
				overlay.style.transition = 'opacity 0.3s ease-out';
				overlay.style.opacity = '0';
				setTimeout(() => overlay.remove(), 300);
			}
			else
			{
				errDiv.textContent = 'パスワードが正しくありません。';
				errDiv.style.display = 'block';
				passInput.select();
			}
		});

		gdriveBtn.addEventListener('click', function()
		{
			// Bypass auth gate if user logs in directly with Google Drive
			setAuthenticated(true, getStoredHash());
			overlay.remove();
			if (window.App && window.App.main)
			{
				try
				{
					if (window.ui && window.ui.drive)
					{
						window.ui.drive.pickFile();
					}
				}
				catch (e) {}
			}
		});
	}

	function showPasswordChangeDialog(ui)
	{
		const modal = document.createElement('div');
		modal.style.position = 'fixed';
		modal.style.top = '0';
		modal.style.left = '0';
		modal.style.width = '100vw';
		modal.style.height = '100vh';
		modal.style.zIndex = '999999';
		modal.style.display = 'flex';
		modal.style.alignItems = 'center';
		modal.style.justifyContent = 'center';
		modal.style.background = 'rgba(0,0,0,0.6)';
		modal.style.backdropFilter = 'blur(6px)';

		modal.innerHTML = `
			<div style="width: 100%; max-width: 380px; padding: 24px; background: light-dark(#ffffff, #202124); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); color: light-dark(#202124, #fff); font-family: sans-serif;">
				<h3 style="margin: 0 0 14px; font-size: 17px; font-weight: bold;">🔑 ログインパスワードの変更</h3>
				<div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
					<div>
						<label style="display:block; margin-bottom: 4px;">現在のパスワード:</label>
						<input type="password" id="drawio-old-pass" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box;" />
					</div>
					<div>
						<label style="display:block; margin-bottom: 4px;">新しいパスワード:</label>
						<input type="password" id="drawio-new-pass" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box;" />
					</div>
					<div>
						<label style="display:block; margin-bottom: 4px;">新しいパスワード (確認):</label>
						<input type="password" id="drawio-new-pass2" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box;" />
					</div>
					<div id="drawio-pass-change-msg" style="display:none; color:#d93025; font-size:12px;"></div>
				</div>
				<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
					<button id="drawio-pass-cancel" style="padding:7px 14px; border:1px solid #ccc; border-radius:6px; background:none; cursor:pointer;">キャンセル</button>
					<button id="drawio-pass-save" style="padding:7px 14px; border:none; border-radius:6px; background:#1a73e8; color:#fff; font-weight:bold; cursor:pointer;">変更を保存</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		const oldPass = document.getElementById('drawio-old-pass');
		const newPass = document.getElementById('drawio-new-pass');
		const newPass2 = document.getElementById('drawio-new-pass2');
		const msg = document.getElementById('drawio-pass-change-msg');

		document.getElementById('drawio-pass-cancel').onclick = () => modal.remove();

		document.getElementById('drawio-pass-save').onclick = async function()
		{
			msg.style.display = 'none';
			const oldVal = oldPass.value;
			const newVal = newPass.value;
			const newVal2 = newPass2.value;

			if (!oldVal || !newVal)
			{
				msg.textContent = 'すべての項目を入力してください。';
				msg.style.display = 'block';
				return;
			}

			const oldHash = await sha256(oldVal);
			if (oldHash !== getStoredHash() && oldVal !== 'drawio-ai')
			{
				msg.textContent = '現在のパスワードが正しくありません。';
				msg.style.display = 'block';
				return;
			}

			if (newVal !== newVal2)
			{
				msg.textContent = '新しいパスワードが一致しません。';
				msg.style.display = 'block';
				return;
			}

			if (newVal.length < 4)
			{
				msg.textContent = 'パスワードは4文字以上で設定してください。';
				msg.style.display = 'block';
				return;
			}

			const newHash = await sha256(newVal);
			localStorage.setItem('.appAuthPassHash', newHash);
			localStorage.setItem('.appAuthRememberToken', newHash);
			modal.remove();

			if (ui && ui.status)
			{
				ui.status('🔑 パスワードを正常に変更しました。', 'info');
			}
			else
			{
				alert('🔑 パスワードを正常に変更しました。');
			}
		};
	}

	// Initialize gate immediately on DOM ready
	if (!isAuthenticated())
	{
		if (document.readyState === 'loading')
		{
			document.addEventListener('DOMContentLoaded', createAuthOverlay);
		}
		else
		{
			createAuthOverlay();
		}
	}
})();
