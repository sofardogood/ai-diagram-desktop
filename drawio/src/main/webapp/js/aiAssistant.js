/**
 * draw.io Desktop - AI Assistant & Official AI Config Extension
 * Seamlessly integrates Google Gemini, OpenAI, Claude, and Ollama into draw.io Desktop.
 * Powers the official "Generate (生成)" chat panel, plus dedicated Auto-Connect, Auto-Complete, and Auto-Layout actions.
 */
(function()
{
	if (typeof Draw === 'undefined')
	{
		window.Draw = {};
	}

	Draw.loadPlugin(function(ui)
	{
		var graph = ui.editor.graph;
		var model = graph.getModel();

		// Helper to request backend AI service via Electron IPC
		function callAiBackend(req)
		{
			return new Promise(function(resolve, reject)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					reject(new Error('Electron IPCが利用できません。'));
					return;
				}

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
			});
		}

		function getAiConfig()
		{
			return new Promise(function(resolve)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					resolve({});
					return;
				}

				electron.request({ action: 'getAiConfig' }, function(res)
				{
					resolve(res || {});
				}, function()
				{
					resolve({});
				});
			});
		}

		function saveAiConfig(cfg)
		{
			return new Promise(function(resolve, reject)
			{
				if (typeof electron === 'undefined' || !electron.request)
				{
					reject(new Error('Electron IPCが利用できません。'));
					return;
				}

				electron.request({ action: 'saveAiConfig', config: cfg }, function(res)
				{
					resolve(res);
				}, function(errMsg)
				{
					reject(new Error(errMsg));
				});
			});
		}

		// Show notification banner / toast
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
					Editor.aiGlobals['geminiApiKey'] = cfg.geminiApiKey;
				}
				if (cfg.gptApiKey)
				{
					conf.gptApiKey = cfg.gptApiKey;
					Editor.aiGlobals['gptApiKey'] = cfg.gptApiKey;
				}
				if (cfg.claudeApiKey)
				{
					conf.claudeApiKey = cfg.claudeApiKey;
					Editor.aiGlobals['claudeApiKey'] = cfg.claudeApiKey;
				}
				if (cfg.gptUrl)
				{
					conf.gptUrl = cfg.gptUrl;
					if (Editor.aiConfigs && Editor.aiConfigs['gpt'])
					{
						Editor.aiConfigs['gpt'].endpoint = cfg.gptUrl;
					}
				}

				localStorage.setItem('.configuration', JSON.stringify(conf));
				if (typeof Editor.configure === 'function')
				{
					Editor.configure(conf);
				}
			}
			catch (e)
			{
				console.error('Failed to sync draw.io configuration:', e);
			}
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
					showToast('⚡ ' + addedEdges.length + ' 本の接続線を自動生成しました！');
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
		// 2. ➕ AI つぎ足し (Auto-Complete / Next Steps)
		// ----------------------------------------------------
		function runAutoComplete()
		{
			var selected = graph.getSelectionCell();
			var targetVertex = null;

			if (selected && model.isVertex(selected))
			{
				targetVertex = selected;
			}
			else
			{
				var all = graph.getChildVertices(graph.getDefaultParent());
				if (all && all.length > 0)
				{
					targetVertex = all[all.length - 1];
				}
			}

			if (!targetVertex)
			{
				ui.alert('つぎ足しの基準となるノードを選択してください。');
				return;
			}

			var currentLabel = getCellLabel(targetVertex) || '現在のステップ';
			var allVertices = graph.getChildVertices(graph.getDefaultParent()) || [];
			var contextLabels = allVertices.map(function(v) { return getCellLabel(v); }).filter(Boolean);

			if (ui.spinner) ui.spinner.spin(document.body, 'AIが次のステップを考えてつぎ足し中...');

			var systemPrompt = 'あなたは業務フロー・システム設計の専門アシスタントです。現在のノードに続く、次に発生すべき論理的なステップ（後続処理、条件分岐、完了処理など）を1〜3個提案してください。\n' +
				'必ず以下のJSON形式のみを出力してください:\n' +
				'[\n' +
				'  { "title": "ステップ名（簡潔に）", "condition": "矢印のラベル（例: 成功, OK, エラー時 等、不要なら空文字）", "type": "process | decision | end" }\n' +
				']';

			var userPrompt = '【全体の流れ】: ' + contextLabels.join(' -> ') + '\n【現在のステップ】: ' + currentLabel + '\nこの後に続くべき次ステップを提案してください。';

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

				var curGeo = model.getGeometry(targetVertex);
				var curX = curGeo ? curGeo.x : 100;
				var curY = curGeo ? curGeo.y : 100;

				model.beginUpdate();
				var newCells = [];
				try
				{
					var parent = graph.getDefaultParent();
					var nodeWidth = 140;
					var nodeHeight = 60;
					var gapX = 180;
					var gapY = 90;

					for (var i = 0; i < nextSteps.length; i++)
					{
						var step = nextSteps[i];
						var targetX = curX + gapX;
						var targetY = curY + (i - (nextSteps.length - 1) / 2) * gapY;

						var style = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';
						if (step.type === 'decision')
						{
							style = 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;';
							nodeWidth = 120;
							nodeHeight = 80;
						}
						else if (step.type === 'end')
						{
							style = 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;';
						}

						var newVertex = graph.insertVertex(parent, null, step.title, targetX, targetY, nodeWidth, nodeHeight, style);
						var edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;';
						var newEdge = graph.insertEdge(parent, null, step.condition || '', targetVertex, newVertex, edgeStyle);

						newCells.push(newVertex);
						newCells.push(newEdge);
					}
				}
				finally
				{
					model.endUpdate();
				}

				graph.setSelectionCells(newCells);
				graph.scrollCellToVisible(newCells[0]);
				showToast('次のステップ（' + nextSteps.length + '件）を追加しました。');
			}).catch(function(err)
			{
				if (ui.spinner) ui.spinner.stop();
				ui.alert('追加エラー: ' + err.message);
			});
		}

		// ----------------------------------------------------
		// 3. AI 自動レイアウト (Auto-Layout)
		// ----------------------------------------------------
		function runAutoLayout()
		{
			var parent = graph.getDefaultParent();
			model.beginUpdate();
			try
			{
				var layout = new mxHierarchicalLayout(graph, mxConstants.DIRECTION_WEST);
				layout.intraCellSpacing = 40;
				layout.interRankCellSpacing = 80;
				layout.parallelEdgeSpacing = 20;
				layout.execute(parent);
			}
			finally
			{
				model.endUpdate();
			}
			showToast('ダイアグラムを整列しました。');
		}

		// ----------------------------------------------------
		// 4. AI 設定ダイアログ
		// ----------------------------------------------------
		function showAiSettingsDialog()
		{
			getAiConfig().then(function(backendCfg)
			{
				var confStr = localStorage.getItem('.configuration');
				var conf = {};
				if (confStr)
				{
					try { conf = JSON.parse(confStr); } catch (e) {}
				}

				var container = document.createElement('div');
				container.style.padding = '18px 22px';
				container.style.boxSizing = 'border-box';
				container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
				container.style.color = 'inherit';

				// Header
				var title = document.createElement('h3');
				title.innerHTML = 'draw.io AI 設定';
				title.style.margin = '0 0 8px 0';
				title.style.fontSize = '16px';
				title.style.color = 'light-dark(#1a73e8, #8ab4f8)';
				container.appendChild(title);

				// Feature Explanation Box
				var featureBox = document.createElement('div');
				featureBox.style.padding = '10px 12px';
				featureBox.style.marginBottom = '14px';
				featureBox.style.borderRadius = '8px';
				featureBox.style.backgroundColor = 'light-dark(#f0f4f9, #28292c)';
				featureBox.style.border = '1px solid light-dark(#d3e3fd, #3c4043)';
				featureBox.style.fontSize = '12px';
				featureBox.style.lineHeight = '1.5';

				featureBox.innerHTML = '<div style="font-weight:bold;color:light-dark(#1a73e8,#8ab4f8);margin-bottom:4px;">機能の概要</div>' +
					'<div style="display:grid;grid-template-columns:1fr;gap:4px;">' +
					'<div><b>ノード間の自動結線:</b> 散らばったボックス同士の関係性を分析し、適切な矢印線で自動接続します。</div>' +
					'<div><b>次のステップ追加:</b> 選択したボックスの後に続く処理・分岐をAIが考えて自動追加します。</div>' +
					'<div><b>チャットで図の生成・修正:</b> 左パネルから日本語で指示するだけで、図の作成や修正ができます。</div>' +
					'</div>';
				container.appendChild(featureBox);

				// Step Instruction
				var stepLabel = document.createElement('div');
				stepLabel.innerHTML = '<b>API キーの設定</b>';
				stepLabel.style.fontSize = '13px';
				stepLabel.style.marginBottom = '10px';
				container.appendChild(stepLabel);

				function createFormField(label, badge, helpHtml, inputEl)
				{
					var row = document.createElement('div');
					row.style.marginBottom = '12px';
					row.style.padding = '8px 10px';
					row.style.borderRadius = '6px';
					row.style.backgroundColor = 'light-dark(#fafafa, #1e1f22)';
					row.style.border = '1px solid light-dark(#e8eaed, #323539)';

					var topRow = document.createElement('div');
					topRow.style.display = 'flex';
					topRow.style.alignItems = 'center';
					topRow.style.justifyContent = 'space-between';
					topRow.style.marginBottom = '4px';

					var lbl = document.createElement('label');
					lbl.innerHTML = label;
					lbl.style.fontSize = '12px';
					lbl.style.fontWeight = 'bold';
					topRow.appendChild(lbl);

					if (badge)
					{
						var bdg = document.createElement('span');
						bdg.innerHTML = badge;
						bdg.style.fontSize = '10px';
						bdg.style.padding = '1px 6px';
						bdg.style.borderRadius = '10px';
						bdg.style.backgroundColor = 'light-dark(#e6f4ea, #1e3a29)';
						bdg.style.color = 'light-dark(#137333, #81c995)';
						bdg.style.fontWeight = 'bold';
						topRow.appendChild(bdg);
					}

					row.appendChild(topRow);
					row.appendChild(inputEl);

					if (helpHtml)
					{
						var h = document.createElement('div');
						h.innerHTML = helpHtml;
						h.style.fontSize = '11px';
						h.style.marginTop = '4px';
						row.appendChild(h);
					}

					return row;
				}

				function createInput(type, val, placeholder)
				{
					var inp = document.createElement('input');
					inp.type = type;
					inp.value = val || '';
					inp.placeholder = placeholder || '';
					inp.style.width = '100%';
					inp.style.padding = '6px 8px';
					inp.style.borderRadius = '4px';
					inp.style.border = '1px solid #dadce0';
					inp.style.fontSize = '12px';
					inp.style.boxSizing = 'border-box';
					return inp;
				}

				// 1. Gemini
				var geminiVal = conf.geminiApiKey || Editor.aiGlobals['geminiApiKey'] || (backendCfg.provider === 'gemini' ? backendCfg.apiKey : '');
				var geminiInput = createInput('password', geminiVal, 'AIzaSy... (Gemini API Key を入力)');
				var geminiRow = createFormField('Google Gemini', '推奨・無料枠あり',
					'<span style="color:#5f6368;">手軽に始めるなら一番おすすめです。</span> <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#1a73e8;text-decoration:underline;font-weight:bold;">Google AI Studio で無料取得する ↗</a>',
					geminiInput);
				container.appendChild(geminiRow);

				// 2. OpenAI
				var gptVal = conf.gptApiKey || Editor.aiGlobals['gptApiKey'] || (backendCfg.provider === 'openai' ? backendCfg.apiKey : '');
				var gptInput = createInput('password', gptVal, 'sk-... (OpenAI API Key を入力)');
				var gptRow = createFormField('OpenAI (ChatGPT / GPT-4o)', '',
					'<a href="https://platform.openai.com/api-keys" target="_blank" style="color:#1a73e8;text-decoration:none;">OpenAI Platform でキーを発行 ↗</a>',
					gptInput);
				container.appendChild(gptRow);

				// 3. Claude
				var claudeVal = conf.claudeApiKey || Editor.aiGlobals['claudeApiKey'] || (backendCfg.provider === 'claude' ? backendCfg.apiKey : '');
				var claudeInput = createInput('password', claudeVal, 'sk-ant-... (Claude API Key を入力)');
				var claudeRow = createFormField('Anthropic Claude (Claude 3.7 Sonnet)', '',
					'<a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#1a73e8;text-decoration:none;">Anthropic Console でキーを発行 ↗</a>',
					claudeInput);
				container.appendChild(claudeRow);

				// 4. Ollama / Custom Endpoint
				var gptUrlVal = conf.gptUrl || backendCfg.endpoint || '';
				var endpointInput = createInput('text', gptUrlVal, 'http://localhost:11434/v1/chat/completions');
				var endpointRow = createFormField('Ollama / ローカルLLM URL (任意)', 'オフライン',
					'<span style="color:#5f6368;">PC内のローカルLLMを使う場合のみ入力（例: <code>http://localhost:11434/v1/chat/completions</code>）</span>',
					endpointInput);
				container.appendChild(endpointRow);

				// Status Indicator
				var statusDiv = document.createElement('div');
				statusDiv.style.fontSize = '12px';
				statusDiv.style.margin = '8px 0';
				statusDiv.style.minHeight = '18px';
				container.appendChild(statusDiv);

				// Action Buttons Row
				var btnRow = document.createElement('div');
				btnRow.style.display = 'flex';
				btnRow.style.justifyContent = 'space-between';
				btnRow.style.alignItems = 'center';
				btnRow.style.marginTop = '14px';

				var testBtn = mxUtils.button('接続テスト', function()
				{
					var gKey = geminiInput.value.trim();
					var oKey = gptInput.value.trim();
					var cKey = claudeInput.value.trim();
					var eUrl = endpointInput.value.trim();

					var testProvider = gKey ? 'gemini' : (oKey ? 'openai' : (cKey ? 'claude' : (eUrl ? 'ollama' : 'gemini')));
					var testKey = gKey || oKey || cKey;

					if (!testKey && !eUrl)
					{
						statusDiv.innerText = 'API キー（Gemini、OpenAI、Claudeのいずれか）を入力してください。';
						statusDiv.style.color = '#ea8600';
						return;
					}

					statusDiv.innerText = '接続テスト中 (' + testProvider.toUpperCase() + ')...';
					statusDiv.style.color = '#1a73e8';

					callAiBackend({
						provider: testProvider,
						apiKey: testKey,
						endpoint: eUrl,
						systemPrompt: 'You are a test assistant.',
						userPrompt: 'Hello'
					}).then(function()
					{
						statusDiv.innerText = '接続成功: AIサービスと正常に対話できました。';
						statusDiv.style.color = '#137333';
					}).catch(function(err)
					{
						statusDiv.innerText = '接続失敗: ' + err.message;
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
					var gVal = geminiInput.value.trim();
					var oVal = gptInput.value.trim();
					var cVal = claudeInput.value.trim();
					var eVal = endpointInput.value.trim();

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

						// Re-open ChatWindow if it was open so backends list refreshes
						if (ui.chatWindow && ui.chatWindow.window && ui.chatWindow.window.isVisible())
						{
							try
							{
								ui.chatWindow.destroy();
								ui.chatWindow = null;
								if (typeof ui.showChatWindow === 'function')
								{
									ui.showChatWindow();
								}
								else if (ui.actions.get('chat'))
								{
									ui.actions.get('chat').funct();
								}
							}
							catch (e) {}
						}

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

				var dlg = new CustomDialog(ui, container, function() {}, function() {}, null, null, 540, 520);
				ui.showDialog(dlg.container, 540, 520, true, true);
			});
		}

		// Register Actions
		ui.actions.addAction('aiAutoConnect', runAutoConnect);
		ui.actions.addAction('aiAutoComplete', runAutoComplete);
		ui.actions.addAction('aiAutoLayout', runAutoLayout);
		ui.actions.addAction('aiSettings', showAiSettingsDialog);

		console.log('✨ draw.io AI Assistant Plugin Initialized Successfully');
	});
})();
