/**
 * draw.io - Universal AI Assistant & Cloud Extension
 * Seamlessly integrates Google Gemini, OpenAI, Claude, and Ollama on both Web and Desktop.
 * Provides Auto-Connect, Auto-Complete, Auto-Layout, AI Chat Panel, and Side AI Browser.
 */
(function()
{
	var isInitialized = false;

	function initPlugin(ui)
	{
		if (isInitialized || !ui || !ui.editor || !ui.editor.graph) return;
		isInitialized = true;
		window.drawioAiUi = ui;

		var graph = ui.editor.graph;
		var model = graph.getModel();

		// Synchronize keys with Editor.aiGlobals and localStorage
		function syncConfiguration(cfg)
		{
			try
			{
				var confStr = localStorage.getItem('.configuration');
				var conf = {};
				if (confStr)
				{
					try { conf = JSON.parse(confStr); } catch (e) {}
				}

				if (cfg.geminiApiKey)
				{
					conf.geminiApiKey = cfg.geminiApiKey;
					if (typeof Editor !== 'undefined' && Editor.aiGlobals) Editor.aiGlobals['geminiApiKey'] = cfg.geminiApiKey;
				}
				if (cfg.gptApiKey)
				{
					conf.gptApiKey = cfg.gptApiKey;
					if (typeof Editor !== 'undefined' && Editor.aiGlobals) Editor.aiGlobals['gptApiKey'] = cfg.gptApiKey;
				}
				if (cfg.claudeApiKey)
				{
					conf.claudeApiKey = cfg.claudeApiKey;
					if (typeof Editor !== 'undefined' && Editor.aiGlobals) Editor.aiGlobals['claudeApiKey'] = cfg.claudeApiKey;
				}
				if (cfg.gptUrl)
				{
					conf.gptUrl = cfg.gptUrl;
					if (typeof Editor !== 'undefined' && Editor.aiConfigs && Editor.aiConfigs['gpt'])
					{
						Editor.aiConfigs['gpt'].endpoint = cfg.gptUrl;
					}
				}

				localStorage.setItem('.configuration', JSON.stringify(conf));
				if (typeof Editor !== 'undefined' && typeof Editor.configure === 'function')
				{
					Editor.configure(conf);
				}
			}
			catch (e)
			{
				console.error('Failed to sync draw.io configuration:', e);
			}
		}

		function getAiConfig()
		{
			return new Promise(function(resolve)
			{
				if (typeof electron !== 'undefined' && electron.request)
				{
					electron.request({ action: 'getAiConfig' }, function(res)
					{
						resolve(res || {});
					}, function()
					{
						resolve({});
					});
					return;
				}

				try
				{
					var stored = localStorage.getItem('.aiConfig');
					if (stored)
					{
						resolve(JSON.parse(stored));
						return;
					}
					var conf = JSON.parse(localStorage.getItem('.configuration') || '{}');
					resolve({
						provider: conf.geminiApiKey ? 'gemini' : (conf.gptApiKey ? 'openai' : (conf.claudeApiKey ? 'claude' : 'gemini')),
						geminiApiKey: conf.geminiApiKey || '',
						gptApiKey: conf.gptApiKey || '',
						claudeApiKey: conf.claudeApiKey || '',
						endpoint: conf.gptUrl || ''
					});
				}
				catch (e)
				{
					resolve({});
				}
			});
		}

		function saveAiConfig(cfg)
		{
			return new Promise(function(resolve, reject)
			{
				try
				{
					localStorage.setItem('.aiConfig', JSON.stringify(cfg));
					syncConfiguration({
						geminiApiKey: cfg.geminiApiKey,
						gptApiKey: cfg.gptApiKey,
						claudeApiKey: cfg.claudeApiKey,
						gptUrl: cfg.endpoint
					});
				}
				catch (e) {}

				if (typeof electron !== 'undefined' && electron.request)
				{
					electron.request({ action: 'saveAiConfig', config: cfg }, function(res)
					{
						resolve(res);
					}, function(errMsg)
					{
						reject(new Error(errMsg));
					});
					return;
				}

				resolve({ success: true });
			});
		}

		// Universal AI Backend (Electron IPC or Browser Direct Fetch)
		function callAiBackend(req)
		{
			return new Promise(function(resolve, reject)
			{
				if (typeof electron !== 'undefined' && electron.request)
				{
					electron.request(Object.assign({ action: 'aiRequest' }, req), function(res)
					{
						if (res && res.text)
						{
							resolve(res.text);
						}
						else
						{
							resolve(res);
						}
					}, function(errMsg, err)
					{
						reject(new Error(errMsg || (err && err.message) || 'AIリクエストに失敗しました。'));
					});
					return;
				}

				// Direct Browser Fetch for Web & Cloud
				getAiConfig().then(function(cfg)
				{
					var provider = req.provider || cfg.provider || (cfg.geminiApiKey ? 'gemini' : (cfg.gptApiKey ? 'openai' : (cfg.claudeApiKey ? 'claude' : 'gemini')));
					var systemPrompt = req.systemPrompt || '';
					var userPrompt = req.userPrompt || '';

					if (provider === 'gemini')
					{
						var apiKey = req.apiKey || cfg.geminiApiKey || cfg.apiKey;
						if (!apiKey)
						{
							reject(new Error('Google Gemini APIキーが設定されていません。「AI ▾」>「AI設定」からAPIキーを入力してください。'));
							return;
						}
						var model = req.model || 'gemini-2.5-flash';
						var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);
						var body = {
							contents: [
								{
									role: 'user',
									parts: [{ text: (systemPrompt ? (systemPrompt + '\n\n') : '') + userPrompt }]
								}
							],
							generationConfig: {
								temperature: 0.2
							}
						};
						fetch(url, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body)
						}).then(function(r) { return r.json(); }).then(function(data)
						{
							if (data.error)
							{
								reject(new Error(data.error.message || 'Gemini API Error'));
								return;
							}
							var text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
							if (text) resolve(text);
							else reject(new Error('Geminiから有効な応答が得られませんでした。'));
						}).catch(function(err)
						{
							reject(new Error('Gemini API通信エラー: ' + err.message));
						});
					}
					else if (provider === 'openai')
					{
						var apiKey = req.apiKey || cfg.gptApiKey || cfg.apiKey;
						if (!apiKey)
						{
							reject(new Error('OpenAI APIキーが設定されていません。「AI ▾」>「AI設定」からAPIキーを入力してください。'));
							return;
						}
						var model = req.model || 'gpt-4o-mini';
						var messages = [];
						if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
						messages.push({ role: 'user', content: userPrompt });

						fetch('https://api.openai.com/v1/chat/completions', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'Authorization': 'Bearer ' + apiKey
							},
							body: JSON.stringify({
								model: model,
								messages: messages,
								temperature: 0.2
							})
						}).then(function(r) { return r.json(); }).then(function(data)
						{
							if (data.error)
							{
								reject(new Error(data.error.message || 'OpenAI API Error'));
								return;
							}
							var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
							if (text) resolve(text);
							else reject(new Error('OpenAIから有効な応答が得られませんでした。'));
						}).catch(function(err)
						{
							reject(new Error('OpenAI API通信エラー: ' + err.message));
						});
					}
					else if (provider === 'claude')
					{
						var apiKey = req.apiKey || cfg.claudeApiKey || cfg.apiKey;
						if (!apiKey)
						{
							reject(new Error('Claude APIキーが設定されていません。「AI ▾」>「AI設定」からAPIキーを入力してください。'));
							return;
						}
						var model = req.model || 'claude-3-5-haiku-20241022';
						fetch('https://api.anthropic.com/v1/messages', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'x-api-key': apiKey,
								'anthropic-version': '2023-06-01',
								'anthropic-dangerous-direct-browser-access': 'true'
							},
							body: JSON.stringify({
								model: model,
								max_tokens: 4096,
								system: systemPrompt,
								messages: [{ role: 'user', content: userPrompt }]
							})
						}).then(function(r) { return r.json(); }).then(function(data)
						{
							if (data.error)
							{
								reject(new Error(data.error.message || 'Claude API Error'));
								return;
							}
							var text = data.content && data.content[0] && data.content[0].text;
							if (text) resolve(text);
							else reject(new Error('Claudeから有効な応答が得られませんでした。'));
						}).catch(function(err)
						{
							reject(new Error('Claude API通信エラー: ' + err.message));
						});
					}
					else
					{
						var endpoint = req.endpoint || cfg.endpoint || 'http://localhost:11434';
						fetch(endpoint + '/v1/chat/completions', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								model: req.model || 'llama3',
								messages: [
									{ role: 'system', content: systemPrompt },
									{ role: 'user', content: userPrompt }
								]
							})
						}).then(function(r) { return r.json(); }).then(function(data)
						{
							var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
							if (text) resolve(text);
							else reject(new Error('Custom Endpointから応答が得られませんでした。'));
						}).catch(function(err)
						{
							reject(new Error('Endpoint通信エラー: ' + err.message));
						});
					}
				}).catch(reject);
			});
		}

		// Show notification toast
		function showToast(message, isError)
		{
			if (ui.status)
			{
				ui.status(message, isError ? 'error' : 'info');
			}
			else
			{
				ui.alert(message);
			}
		}

		// Helper to extract clean text / label from cell
		function getCellLabel(cell)
		{
			var val = cell.value;
			if (!val) return '';
			if (typeof val === 'string')
			{
				var tmp = document.createElement('div');
				tmp.innerHTML = val;
				return (tmp.textContent || tmp.innerText || '').trim();
			}
			if (val.getAttribute && val.getAttribute('label'))
			{
				return val.getAttribute('label');
			}
			return '';
		}

		// Initial load sync
		getAiConfig().then(function(cfg)
		{
			if (cfg && (cfg.geminiApiKey || cfg.gptApiKey || cfg.claudeApiKey || cfg.apiKey))
			{
				var normalized = {
					geminiApiKey: cfg.geminiApiKey || (cfg.provider === 'gemini' ? cfg.apiKey : null),
					gptApiKey: cfg.gptApiKey || (cfg.provider === 'openai' ? cfg.apiKey : null),
					claudeApiKey: cfg.claudeApiKey || (cfg.provider === 'claude' ? cfg.apiKey : null),
					gptUrl: cfg.endpoint || (cfg.provider === 'ollama' || cfg.provider === 'custom' ? cfg.endpoint : null)
				};
				syncConfiguration(normalized);
			}
		});

		// ----------------------------------------------------
		// 1. ⚡ AI 自動配線 (Auto-Connect / Wire)
		// ----------------------------------------------------
		function runAutoConnect()
		{
			var selectedCells = graph.getSelectionCells();
			var vertices = [];

			if (selectedCells && selectedCells.length > 1)
			{
				for (var i = 0; i < selectedCells.length; i++)
				{
					if (model.isVertex(selectedCells[i]))
					{
						vertices.push(selectedCells[i]);
					}
				}
			}

			if (vertices.length === 0)
			{
				var allChildren = graph.getChildVertices(graph.getDefaultParent());
				if (allChildren && allChildren.length > 0)
				{
					vertices = allChildren;
				}
			}

			if (vertices.length < 2)
			{
				ui.alert('自動結線を行うには、キャンバス上に少なくとも2つ以上のノードが必要です。');
				return;
			}

			var nodesData = [];
			for (var j = 0; j < vertices.length; j++)
			{
				var v = vertices[j];
				var geo = model.getGeometry(v);
				nodesData.push({
					id: v.id,
					text: getCellLabel(v) || ('Node_' + (j + 1)),
					x: geo ? Math.round(geo.x) : 0,
					y: geo ? Math.round(geo.y) : 0
				});
			}

			if (ui.spinner) ui.spinner.spin(document.body, 'AIがノード間の関係性を解析して結線中...');

			var systemPrompt = 'あなたはダイアグラム設計の専門家です。与えられたダイアグラムのノード一覧（ID、テキスト、位置）を分析し、論理的な処理フローや依存関係に基づいて、どのノードからどのノードへ線を結ぶべきかを決定してください。\n' +
				'必ず以下のJSON形式のみを出力してください（Markdownコードブロックや説明文は含めないでください）:\n' +
				'[\n' +
				'  { "source": "ノードID", "target": "ノードID", "label": "条件や関係ラベル(省略可)" }\n' +
				']';

			var userPrompt = '以下のノード群を論理的なフローとして適切に接続する結線リストを作成してください:\n' + JSON.stringify(nodesData, null, 2);

			callAiBackend({
				systemPrompt: systemPrompt,
				userPrompt: userPrompt
			}).then(function(responseText)
			{
				if (ui.spinner) ui.spinner.stop();

				var cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
				var connections = [];
				try
				{
					connections = JSON.parse(cleanJson);
				}
				catch (e)
				{
					var m = cleanJson.match(/\[[\s\S]*\]/);
					if (m)
					{
						connections = JSON.parse(m[0]);
					}
					else
					{
						throw new Error('AIの応答をJSONとして解析できませんでした: ' + responseText);
					}
				}

				if (!Array.isArray(connections) || connections.length === 0)
				{
					ui.alert('AIが適切な接続関係を検出できませんでした。');
					return;
				}

				model.beginUpdate();
				var addedEdges = [];
				try
				{
					var parent = graph.getDefaultParent();
					var edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;';

					for (var k = 0; k < connections.length; k++)
					{
						var conn = connections[k];
						var sourceCell = model.getCell(conn.source);
						var targetCell = model.getCell(conn.target);

						if (sourceCell && targetCell && sourceCell !== targetCell)
						{
							var existingEdges = graph.getEdgesBetween(sourceCell, targetCell, true);
							if (!existingEdges || existingEdges.length === 0)
							{
								var edge = graph.insertEdge(parent, null, conn.label || '', sourceCell, targetCell, edgeStyle);
								addedEdges.push(edge);
							}
						}
					}
				}
				finally
				{
					model.endUpdate();
				}

				if (addedEdges.length > 0)
				{
					graph.setSelectionCells(addedEdges);
					showToast(addedEdges.length + ' 本の接続線を自動生成しました。');
				}
				else
				{
					showToast('接続対象の線は既に存在しています。');
				}
			}).catch(function(err)
			{
				if (ui.spinner) ui.spinner.stop();
				ui.alert('自動結線エラー: ' + err.message);
			});
		}

		// ----------------------------------------------------
		// 2. ⚡ AI 次のステップ追加 (Auto-Complete)
		// ----------------------------------------------------
		function runAutoComplete()
		{
			var selectedCells = graph.getSelectionCells();
			var targetVertex = null;

			if (selectedCells && selectedCells.length > 0)
			{
				for (var i = 0; i < selectedCells.length; i++)
				{
					if (model.isVertex(selectedCells[i]))
					{
						targetVertex = selectedCells[i];
						break;
					}
				}
			}

			if (!targetVertex)
			{
				ui.alert('追加の基準となるノードを1つ選択してください。');
				return;
			}

			var baseText = getCellLabel(targetVertex) || '基準ステップ';
			var baseGeo = model.getGeometry(targetVertex);
			var baseX = baseGeo ? baseGeo.x : 100;
			var baseY = baseGeo ? baseGeo.y : 100;
			var baseW = baseGeo ? baseGeo.width : 120;
			var baseH = baseGeo ? baseGeo.height : 60;

			if (ui.spinner) ui.spinner.spin(document.body, 'AIが次の論理ステップを考案中...');

			var systemPrompt = 'あなたは業務フローおよびシステム設計のエキスパートです。ユーザーが指定したステップに続く、論理的で自然な「次のステップ（1〜3個）」を提案してください。\n' +
				'必ず以下のJSON形式のみを出力してください:\n' +
				'[\n' +
				'  { "label": "次のステップのタイトル・説明", "condition": "分岐条件(任意)" }\n' +
				']';

			var userPrompt = '現在のステップ: 「' + baseText + '」\nこの直後に続く論理的な次ステップを生成してください。';

			callAiBackend({
				systemPrompt: systemPrompt,
				userPrompt: userPrompt
			}).then(function(responseText)
			{
				if (ui.spinner) ui.spinner.stop();

				var cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
				var nextSteps = [];
				try
				{
					nextSteps = JSON.parse(cleanJson);
				}
				catch (e)
				{
					var m = cleanJson.match(/\[[\s\S]*\]/);
					if (m) nextSteps = JSON.parse(m[0]);
					else throw new Error('AIの応答をJSONとして解析できませんでした: ' + responseText);
				}

				if (!Array.isArray(nextSteps) || nextSteps.length === 0)
				{
					ui.alert('次ステップの提案が得られませんでした。');
					return;
				}

				model.beginUpdate();
				var createdCells = [];
				try
				{
					var parent = graph.getDefaultParent();
					var edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;';
					var vertexStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';

					var spacingY = 100;
					var startY = baseY + baseH + 60;

					for (var k = 0; k < nextSteps.length; k++)
					{
						var step = nextSteps[k];
						var offsetX = (k - (nextSteps.length - 1) / 2) * (baseW + 50);
						var posX = Math.max(20, baseX + offsetX);
						var posY = startY + (k * 20);

						var newV = graph.insertVertex(parent, null, step.label, posX, posY, baseW, baseH, vertexStyle);
						var newEdge = graph.insertEdge(parent, null, step.condition || '', targetVertex, newV, edgeStyle);

						createdCells.push(newV);
						createdCells.push(newEdge);
					}
				}
				finally
				{
					model.endUpdate();
				}

				if (createdCells.length > 0)
				{
					graph.setSelectionCells(createdCells);
					graph.scrollCellToVisible(createdCells[0]);
					showToast('次のステップ（' + nextSteps.length + '件）を追加しました。');
				}
			}).catch(function(err)
			{
				if (ui.spinner) ui.spinner.stop();
				ui.alert('追加エラー: ' + err.message);
			});
		}

		// ----------------------------------------------------
		// 3. ⚡ AI 自動レイアウト (Auto-Layout)
		// ----------------------------------------------------
		function runAutoLayout()
		{
			var parent = graph.getDefaultParent();
			var layout = new mxHierarchicalLayout(graph, mxConstants.DIRECTION_NORTH);
			layout.intraCellSpacing = 50;
			layout.interRankCellSpacing = 80;

			model.beginUpdate();
			try
			{
				layout.execute(parent);
			}
			catch (err)
			{
				console.error('Layout error:', err);
			}
			finally
			{
				model.endUpdate();
			}

			showToast('ダイアグラムを自動整列しました。');
		}

		// ----------------------------------------------------
		// 4. ⚙️ AI 設定ダイアログ (Settings Modal)
		// ----------------------------------------------------
		function showAiSettingsDialog()
		{
			getAiConfig().then(function(cfg)
			{
				var container = document.createElement('div');
				container.style.padding = '12px 16px';
				container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
				container.style.color = 'light-dark(#202124, #ffffff)';

				var title = document.createElement('h3');
				title.textContent = 'AI アシスタント設定 (API キー & モデル)';
				title.style.margin = '0 0 16px 0';
				title.style.fontSize = '16px';
				title.style.fontWeight = '600';
				container.appendChild(title);

				function createInputRow(labelText, placeholder, currentValue, helpText)
				{
					var row = document.createElement('div');
					row.style.marginBottom = '14px';

					var label = document.createElement('label');
					label.textContent = labelText;
					label.style.display = 'block';
					label.style.fontSize = '12px';
					label.style.fontWeight = '600';
					label.style.marginBottom = '4px';
					row.appendChild(label);

					var input = document.createElement('input');
					input.type = 'password';
					input.placeholder = placeholder;
					input.value = currentValue || '';
					input.style.width = '100%';
					input.style.padding = '7px 10px';
					input.style.fontSize = '13px';
					input.style.borderRadius = '5px';
					input.style.border = '1px solid light-dark(#dadce0, #5f6368)';
					input.style.backgroundColor = 'light-dark(#ffffff, #292a2d)';
					input.style.color = 'inherit';
					input.style.boxSizing = 'border-box';
					row.appendChild(input);

					if (helpText)
					{
						var help = document.createElement('div');
						help.textContent = helpText;
						help.style.fontSize = '11px';
						help.style.color = 'light-dark(#5f6368, #9aa0a6)';
						help.style.marginTop = '3px';
						row.appendChild(help);
					}

					return { row: row, input: input };
				}

				var geminiRow = createInputRow('Google Gemini API Key (おすすめ・無料枠あり)', 'AIzaSy...', cfg.geminiApiKey || (cfg.provider === 'gemini' ? cfg.apiKey : ''), 'Google AI Studio で無料取得できるAPIキーです。');
				var gptRow = createInputRow('OpenAI API Key (ChatGPT)', 'sk-...', cfg.gptApiKey || (cfg.provider === 'openai' ? cfg.apiKey : ''), 'OpenAI プラットフォームで発行したAPIキーです。');
				var claudeRow = createInputRow('Anthropic Claude API Key', 'sk-ant-...', cfg.claudeApiKey || (cfg.provider === 'claude' ? cfg.apiKey : ''), 'Anthropic Console で発行したAPIキーです。');

				var endpointRow = createInputRow('Ollama / Custom Endpoint', 'http://localhost:11434', cfg.endpoint || '', 'ローカルLLMやカスタムAPIの接続先URLです。');
				endpointRow.input.type = 'text';

				container.appendChild(geminiRow.row);
				container.appendChild(gptRow.row);
				container.appendChild(claudeRow.row);
				container.appendChild(endpointRow.row);

				var statusDiv = document.createElement('div');
				statusDiv.style.fontSize = '12px';
				statusDiv.style.marginBottom = '14px';
				statusDiv.style.minHeight = '18px';
				statusDiv.style.fontWeight = '500';
				container.appendChild(statusDiv);

				var btnRow = document.createElement('div');
				btnRow.style.display = 'flex';
				btnRow.style.justifyContent = 'space-between';
				btnRow.style.alignItems = 'center';
				btnRow.style.marginTop = '16px';

				var testBtn = mxUtils.button('⚡ 接続テスト', function()
				{
					var gVal = geminiRow.input.value.trim();
					var oVal = gptRow.input.value.trim();
					var cVal = claudeRow.input.value.trim();
					var eVal = endpointRow.input.value.trim();

					var testProvider = gVal ? 'gemini' : (oVal ? 'openai' : (cVal ? 'claude' : (eVal ? 'ollama' : 'gemini')));
					var testKey = gVal || oVal || cVal;

					if (!testKey && !eVal)
					{
						statusDiv.innerText = '⚠️ いずれかのAPIキーを入力してください。';
						statusDiv.style.color = '#d93025';
						return;
					}

					statusDiv.innerText = '接続テスト中 (' + testProvider + ')...';
					statusDiv.style.color = '#1a73e8';

					callAiBackend({
						provider: testProvider,
						apiKey: testKey,
						endpoint: eVal,
						systemPrompt: 'あなたはAIアシスタントです。',
						userPrompt: '「接続成功」とだけ返答してください。'
					}).then(function(res)
					{
						statusDiv.innerText = '✅ 接続成功！ (' + testProvider + ' から応答がありました)';
						statusDiv.style.color = '#137333';
					}).catch(function(err)
					{
						statusDiv.innerText = '❌ 接続失敗: ' + err.message;
						statusDiv.style.color = '#c5221f';
					});
				});
				testBtn.className = 'geBtn';

				var rightBtns = document.createElement('div');
				rightBtns.style.display = 'flex';
				rightBtns.style.gap = '8px';

				var cancelBtn = mxUtils.button(mxResources.get('cancel') || 'キャンセル', function()
				{
					ui.hideDialog();
				});
				cancelBtn.className = 'geBtn';

				var saveBtn = mxUtils.button('設定を保存', function()
				{
					var gVal = geminiRow.input.value.trim();
					var oVal = gptRow.input.value.trim();
					var cVal = claudeRow.input.value.trim();
					var eVal = endpointRow.input.value.trim();

					var activeProvider = gVal ? 'gemini' : (oVal ? 'openai' : (cVal ? 'claude' : (eVal ? 'ollama' : 'gemini')));
					var activeKey = gVal || oVal || cVal;

					var newBackendCfg = {
						provider: activeProvider,
						apiKey: activeKey,
						geminiApiKey: gVal,
						gptApiKey: oVal,
						claudeApiKey: cVal,
						endpoint: eVal
					};

					saveAiConfig(newBackendCfg).then(function()
					{
						syncConfiguration({
							geminiApiKey: gVal,
							gptApiKey: oVal,
							claudeApiKey: cVal,
							gptUrl: eVal
						});

						ui.hideDialog();
						showToast('AI設定を保存しました。');
					}).catch(function(err)
					{
						ui.alert('保存エラー: ' + err.message);
					});
				});
				saveBtn.className = 'geBtn gePrimaryBtn';

				btnRow.appendChild(testBtn);
				rightBtns.appendChild(cancelBtn);
				rightBtns.appendChild(saveBtn);
				btnRow.appendChild(rightBtns);
				container.appendChild(btnRow);

				var dlg = new CustomDialog(ui, container, function() {}, function() {}, null, null, 540, 480);
				ui.showDialog(dlg.container, 540, 480, true, true);
			});
		}

		// ----------------------------------------------------
		// 5. 🌐 Web & Desktop AI Browser Panel (window.drawioAiBrowser)
		// ----------------------------------------------------
		if (!window.drawioAiBrowser)
		{
			window.drawioAiBrowser = (function()
			{
				var isAutoStickyEnabled = localStorage.getItem('.aiAutoStickyNote') === 'true';
				var stickyNoteCounter = 0;
				var lastClipboardText = '';

				function isAutoSticky()
				{
					return isAutoStickyEnabled;
				}

				function toggleAutoSticky(forcedVal)
				{
					if (typeof forcedVal === 'boolean') isAutoStickyEnabled = forcedVal;
					else isAutoStickyEnabled = !isAutoStickyEnabled;
					localStorage.setItem('.aiAutoStickyNote', isAutoStickyEnabled ? 'true' : 'false');
					showToast(isAutoStickyEnabled ? '📌 自動付箋モードを ON にしました（コピーしたテキストが自動で付箋になります）' : '📌 自動付箋モードを OFF にしました');
					return isAutoStickyEnabled;
				}

				function insertStickyNote(text)
				{
					if (!text || typeof text !== 'string') return null;
					var cleanText = text.trim();
					if (!cleanText) return null;

					var graph = ui.editor.graph;
					var model = graph.getModel();
					var parent = graph.getDefaultParent();

					var lines = cleanText.split('\n');
					var maxLineLen = 0;
					for (var i = 0; i < lines.length; i++)
					{
						if (lines[i].length > maxLineLen) maxLineLen = lines[i].length;
					}

					var w = Math.min(360, Math.max(180, Math.min(280, maxLineLen * 9 + 40)));
					var h = Math.min(480, Math.max(100, Math.max(lines.length * 22 + 40, Math.ceil(cleanText.length / 18) * 20 + 40)));

					var view = graph.view;
					var scale = view.scale || 1;
					var translate = view.translate || { x: 0, y: 0 };
					var container = graph.container;

					var visibleCenterX = (-translate.x + (container.clientWidth / 2) / scale);
					var visibleCenterY = (-translate.y + (container.clientHeight / 2) / scale);

					var offset = (stickyNoteCounter % 7) * 24;
					stickyNoteCounter++;

					var posX = Math.max(20, Math.round(visibleCenterX - (w / 2) + offset));
					var posY = Math.max(20, Math.round(visibleCenterY - (h / 2) + offset));

					var colors = [
						{ fill: '#FFF9B2', stroke: '#d6b656' },
						{ fill: '#D5E8D4', stroke: '#82B366' },
						{ fill: '#DAE8FC', stroke: '#6C8EBF' },
						{ fill: '#F8CECC', stroke: '#B85450' },
						{ fill: '#FFE6CC', stroke: '#D79B00' }
					];
					var color = colors[(stickyNoteCounter - 1) % colors.length];

					var noteStyle = 'shape=note;whiteSpace=wrap;html=1;size=16;' +
						'fillColor=' + color.fill + ';strokeColor=' + color.stroke + ';' +
						'fontColor=#222222;fontSize=13;align=left;verticalAlign=top;spacing=10;spacingTop=6;shadow=1;';

					model.beginUpdate();
					var vertex = null;
					try
					{
						vertex = graph.insertVertex(parent, null, cleanText, posX, posY, w, h, noteStyle);
						graph.setSelectionCell(vertex);
						graph.scrollCellToVisible(vertex);
					}
					catch (err)
					{
						console.error('Failed to insert sticky note:', err);
					}
					finally
					{
						model.endUpdate();
					}

					showToast('📌 付箋をキャンバスに貼り付けました');
					return vertex;
				}

				// Clipboard watcher for Web & Desktop on window focus / copy
				window.addEventListener('focus', function()
				{
					if (!isAutoStickyEnabled) return;
					if (navigator.clipboard && navigator.clipboard.readText)
					{
						navigator.clipboard.readText().then(function(text)
						{
							if (text && text.trim() && text !== lastClipboardText && !text.startsWith('<mxfile') && text.length < 50000)
							{
								lastClipboardText = text;
								insertStickyNote(text);
							}
						}).catch(function() {});
					}
				});

				// Open Preset: Opens in browser window with persistent native cookies & Google login
				function openPreset(url, name)
				{
					var winName = 'drawio_ai_side_' + (name ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'window');
					var w = 560;
					var h = 860;
					var left = Math.max(0, window.screen.width - w - 20);
					var top = 50;

					var win = window.open(url, winName, 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes,status=no');
					if (win) win.focus();
				}

				function open(url)
				{
					openPreset(url || 'https://chatgpt.com', 'AI');
				}

				function close() {}
				function toggle(url) { open(url); }

				return {
					open: open,
					close: close,
					toggle: toggle,
					openPreset: openPreset,
					insertStickyNote: insertStickyNote,
					isAutoSticky: isAutoSticky,
					toggleAutoSticky: toggleAutoSticky
				};
			})();
		}

		// ----------------------------------------------------
		// 6. 🎨 Inject AI and Browser Toolbar Buttons (Web & Desktop)
		// ----------------------------------------------------
		function injectAiToolbarButtons()
		{
			try
			{
				if (document.getElementById('drawio-ai-toolbar-btn')) return;

				var tbContainer = document.querySelector('.geToolbar') || (ui.toolbar && ui.toolbar.container);
				if (!tbContainer) return;

				// AI ▾ Button
				var aiBtn = document.createElement('a');
				aiBtn.id = 'drawio-ai-toolbar-btn';
				aiBtn.className = 'geButton';
				aiBtn.setAttribute('title', 'AI アシスタント (自動結線・追加・レイアウト・設定)');
				aiBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:3px;font-weight:600;color:light-dark(#1a73e8,#8ab4f8);font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid light-dark(#dadce0,#5f6368);background:light-dark(#f8f9fa,#292a2d);cursor:pointer;">AI ▾</span>';

				mxEvent.addListener(aiBtn, 'click', function(evt)
				{
					var rect = aiBtn.getBoundingClientRect();
					ui.showPopupMenu(function(m, p)
					{
						m.addItem('⚡ 線の自動接続 (Auto-Connect)', null, runAutoConnect, p);
						m.addItem('➕ 次のステップを追加 (Auto-Complete)', null, runAutoComplete, p);
						m.addItem('📐 自動レイアウト整形 (Auto-Layout)', null, runAutoLayout, p);
						m.addSeparator(p);
						m.addItem('🌐 ChatGPT を開く (Cookie保持)', null, function() { window.drawioAiBrowser.openPreset('https://chatgpt.com', 'ChatGPT'); }, p);
						m.addItem('🌐 Claude を開く (Cookie保持)', null, function() { window.drawioAiBrowser.openPreset('https://claude.ai', 'Claude'); }, p);
						m.addItem('🌐 Gemini を開く (Cookie保持)', null, function() { window.drawioAiBrowser.openPreset('https://gemini.google.com', 'Gemini'); }, p);
						m.addItem('🌐 Perplexity を開く (Cookie保持)', null, function() { window.drawioAiBrowser.openPreset('https://www.perplexity.ai', 'Perplexity'); }, p);
						m.addSeparator(p);
						m.addItem(window.drawioAiBrowser.isAutoSticky() ? '📌 自動付箋モード: ON (クリックでOFF)' : '📌 自動付箋モード: OFF (クリックでON)', null, function()
						{
							window.drawioAiBrowser.toggleAutoSticky();
						}, p);
						m.addItem('📋 クリップボード/選択テキストを付箋化', null, function()
						{
							if (navigator.clipboard && navigator.clipboard.readText)
							{
								navigator.clipboard.readText().then(function(t)
								{
									if (t && t.trim()) window.drawioAiBrowser.insertStickyNote(t);
									else ui.alert('クリップボードにテキストがありません。');
								}).catch(function() { ui.alert('クリップボードの読み取りを許可してください。'); });
							}
						}, p);
						m.addSeparator(p);
						m.addItem('⚙️ AI 設定 (API キー・モデル)...', null, showAiSettingsDialog, p);
						m.addItem('🔑 ログインパスワードの変更...', null, function()
						{
							if (window.drawioAuthGate && window.drawioAuthGate.showPasswordChangeDialog)
							{
								window.drawioAuthGate.showPasswordChangeDialog(ui);
							}
						}, p);
						m.addItem('🔒 画面をロック (ログアウト)', null, function()
						{
							if (window.drawioAuthGate && window.drawioAuthGate.logout)
							{
								window.drawioAuthGate.logout();
							}
						}, p);
					}, rect.left, rect.bottom + 4, evt);
					mxEvent.consume(evt);
				});

				// Browser Button
				var browserBtn = document.createElement('a');
				browserBtn.id = 'drawio-ai-browser-toolbar-btn';
				browserBtn.className = 'geButton';
				browserBtn.setAttribute('title', 'AI ブラウザ (ChatGPT / Claude / Gemini を開く)');
				browserBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:3px;font-weight:600;color:light-dark(#1a73e8,#8ab4f8);font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid light-dark(#dadce0,#5f6368);background:light-dark(#f8f9fa,#292a2d);cursor:pointer;">ブラウザ ◨</span>';

				mxEvent.addListener(browserBtn, 'click', function(evt)
				{
					var rect = browserBtn.getBoundingClientRect();
					ui.showPopupMenu(function(m, p)
					{
						m.addItem('🤖 ChatGPT (chatgpt.com)', null, function() { window.drawioAiBrowser.openPreset('https://chatgpt.com', 'ChatGPT'); }, p);
						m.addItem('🔮 Claude (claude.ai)', null, function() { window.drawioAiBrowser.openPreset('https://claude.ai', 'Claude'); }, p);
						m.addItem('✨ Gemini (gemini.google.com)', null, function() { window.drawioAiBrowser.openPreset('https://gemini.google.com', 'Gemini'); }, p);
						m.addItem('🔍 Perplexity (perplexity.ai)', null, function() { window.drawioAiBrowser.openPreset('https://www.perplexity.ai', 'Perplexity'); }, p);
						m.addSeparator(p);
						m.addItem(window.drawioAiBrowser.isAutoSticky() ? '📌 自動付箋モード: ON' : '📌 自動付箋モード: OFF', null, function()
						{
							window.drawioAiBrowser.toggleAutoSticky();
						}, p);
					}, rect.left, rect.bottom + 4, evt);
					mxEvent.consume(evt);
				});

				tbContainer.appendChild(aiBtn);
				tbContainer.appendChild(browserBtn);
			}
			catch (e)
			{
				console.error('Failed to inject AI toolbar buttons:', e);
			}
		}

		// Inject buttons after UI is fully ready
		setInterval(injectAiToolbarButtons, 500);

		// Register Actions
		ui.actions.addAction('aiAutoConnect', runAutoConnect);
		ui.actions.addAction('aiAutoComplete', runAutoComplete);
		ui.actions.addAction('aiAutoLayout', runAutoLayout);
		ui.actions.addAction('aiSettings', showAiSettingsDialog);

		window.drawioAi = {
			runAutoConnect: runAutoConnect,
			runAutoComplete: runAutoComplete,
			runAutoLayout: runAutoLayout,
			showAiSettingsDialog: showAiSettingsDialog
		};

		console.log('✨ Universal draw.io AI Assistant Plugin Initialized (Web & Desktop)');
	}

	// 1. If Draw.loadPlugin exists, register callback
	if (typeof window.Draw === 'undefined')
	{
		window.Draw = {};
	}

	if (typeof window.Draw.loadPlugin === 'function')
	{
		window.Draw.loadPlugin(initPlugin);
	}
	else
	{
		window.Draw.loadPlugin = function(cb)
		{
			if (typeof App !== 'undefined' && App.DrawPlugins)
			{
				App.DrawPlugins.push(cb);
			}
			else
			{
				var checkUi = function()
				{
					if (window.ui && window.ui.editor) cb(window.ui);
					else setTimeout(checkUi, 100);
				};
				checkUi();
			}
		};
		window.Draw.loadPlugin(initPlugin);
	}

	// 2. Poll for editorUi to ensure initialization on any load timing
	function pollEditorUi()
	{
		var curUi = window.ui || (window.App && window.App.main && window.App.main.editorUi);
		if (curUi && curUi.editor && curUi.editor.graph)
		{
			initPlugin(curUi);
		}
		else
		{
			setTimeout(pollEditorUi, 200);
		}
	}
	pollEditorUi();
})();
