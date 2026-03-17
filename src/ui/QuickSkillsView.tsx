import { ItemView, MarkdownRenderer, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type QuickSkillsPlugin from "../main";
import { CodexStreamAccumulator } from "../codex/streamAccumulator";
import type { AppViewUpdate } from "../state/uiChange";
import type { ChatActivity, ChatMessage, ChatTraceItem, SandboxMode, SessionSummary, SkillDefinition } from "../types";
import { DictationSession } from "../voice/dictationSession";
import { SessionRenameModal } from "./SessionRenameModal";
import { closeOpenPopoverMenus, updatePopoverDirection } from "./sidebar/popover";

export const QUICK_SKILLS_VIEW_TYPE = "quick-skills-sidebar";

export class QuickSkillsView extends ItemView {
	private readonly plugin: QuickSkillsPlugin;
	private notifyRender: ((change: AppViewUpdate) => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: QuickSkillsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return QUICK_SKILLS_VIEW_TYPE;
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		return "Quick Skills";
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("quick-skills-view");
		this.registerDomEvent(document, "pointerdown", (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".quick-skills-popover-menu")) {
				return;
			}
			closeOpenPopoverMenus(contentEl);
		});
		this.registerDomEvent(contentEl, "click", (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const internalLink = target.closest<HTMLAnchorElement>("a.internal-link");
			if (!internalLink) {
				return;
			}
			const linkText = (
				internalLink.getAttribute("data-href")
				?? internalLink.getAttribute("href")
				?? internalLink.textContent
				?? ""
			).trim();
			if (!linkText || /^(?:https?:|mailto:|obsidian:)/u.test(linkText)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void this.plugin.app.workspace.openLinkText(
				linkText,
				this.plugin.getMarkdownRenderSourcePath(),
				false
			);
		});
		render(
			<SidebarApp
				plugin={this.plugin}
				view={this}
				onReady={(notifyRender) => {
					this.notifyRender = notifyRender;
				}}
			/>,
			contentEl
		);
	}

	async onClose(): Promise<void> {
		this.notifyRender = null;
		render(null, this.contentEl);
	}

	requestRender(change: AppViewUpdate): void {
		this.notifyRender?.(change);
	}
}

function SidebarApp(props: {
	plugin: QuickSkillsPlugin;
	view: QuickSkillsView;
	onReady: (notifyRender: (change: AppViewUpdate) => void) => void;
}) {
	const { plugin, view, onReady } = props;
	const [, setSignal] = useState(0);

	useEffect(() => {
		onReady(() => {
			setSignal((value) => value + 1);
		});
		return () => {
			onReady(() => undefined);
		};
	}, [onReady]);

	const contentRef = useRef<HTMLDivElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const [input, setInput] = useState("");
	const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set());
	const [collapsedActivityIds, setCollapsedActivityIds] = useState<Set<string>>(new Set());
	const [expandedReasoningMessageIds, setExpandedReasoningMessageIds] = useState<Set<string>>(new Set());
	const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);
	const dictation = useDictation(plugin, setInput);

	const messages = plugin.getCurrentTranscript();
	const sessions = plugin.sessions;
	const applicableSkills = plugin.getApplicableSkills();
	const activeSessionId = plugin.activeSessionId;
	const activeSession = plugin.getActiveSessionSummary();
	const markdownSourcePath = plugin.getMarkdownRenderSourcePath();
	const controlsBlocked = plugin.isRunning || dictation.isBusy;
	const handleToggleReasoning = useCallback((messageId: string) => {
		setExpandedReasoningMessageIds((current) => {
			const next = new Set(current);
			if (next.has(messageId)) {
				next.delete(messageId);
			} else {
				next.add(messageId);
				setPendingScrollMessageId(messageId);
			}
			return next;
		});
	}, []);
	const handleScrollHandled = useCallback(() => {
		setPendingScrollMessageId(null);
	}, []);

	useEffect(() => {
		const visibleIds = new Set<string>();
		for (const message of messages) {
			for (const item of message.turnTrace?.items ?? []) {
				if (item.kind === "activity" && item.activity) {
					visibleIds.add(item.activity.id);
				}
			}
			for (const activity of message.turnTrace?.activities ?? []) {
				visibleIds.add(activity.id);
			}
		}
		setExpandedActivityIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
		setCollapsedActivityIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
	}, [messages]);

	useEffect(() => {
		const visibleIds = new Set(
			messages
				.filter((message) => message.role === "assistant" && hasStoredTurnTrace(plugin, message))
				.map((message) => message.id)
		);
		setExpandedReasoningMessageIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
	}, [messages, plugin]);

	useAutosizeTextArea(input);

	return (
		<div ref={contentRef} class="quick-skills-view-shell">
			<SessionHeader
				plugin={plugin}
				sessions={sessions}
				activeSessionId={activeSessionId}
				activeSession={activeSession}
				contentEl={contentRef.current}
				transcriptEl={transcriptRef.current}
			/>
			<TranscriptPane
				plugin={plugin}
				view={view}
				messages={messages}
				markdownSourcePath={markdownSourcePath}
				transcriptRef={transcriptRef}
				expandedActivityIds={expandedActivityIds}
				collapsedActivityIds={collapsedActivityIds}
				setExpandedActivityIds={setExpandedActivityIds}
				setCollapsedActivityIds={setCollapsedActivityIds}
				expandedReasoningMessageIds={expandedReasoningMessageIds}
				onToggleReasoning={handleToggleReasoning}
				pendingScrollMessageId={pendingScrollMessageId}
				onScrollHandled={handleScrollHandled}
			/>
			<Composer
				plugin={plugin}
				input={input}
				onInputChange={setInput}
				controlsBlocked={controlsBlocked}
				applicableSkills={applicableSkills}
				contentEl={contentRef.current}
				transcriptEl={transcriptRef.current}
				dictation={dictation}
				onSubmit={async () => {
					const prompt = input.trim();
					if (!prompt || dictation.isBusy) {
						return;
					}
					setInput("");
					await plugin.runManualPrompt(prompt);
				}}
			/>
		</div>
	);
}

function SessionHeader(props: {
	plugin: QuickSkillsPlugin;
	sessions: SessionSummary[];
	activeSessionId: string;
	activeSession?: SessionSummary;
	contentEl: HTMLElement | null;
	transcriptEl: HTMLElement | null;
}) {
	const { plugin, sessions, activeSessionId, activeSession, contentEl, transcriptEl } = props;
	const menuRef = useRef<HTMLDetailsElement | null>(null);
	const summaryRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (summaryRef.current) {
			setIcon(summaryRef.current, "settings");
		}
	}, []);

	return (
		<div class="quick-skills-topbar">
			<div class="quick-skills-topbar-label">Session</div>
			<div class="quick-skills-session-group">
				<select
						class="quick-skills-session-select"
						value={activeSessionId}
						onChange={(event) => {
							void plugin.setActiveSession(event.currentTarget.value);
						}}
				>
					{sessions.map((session) => (
						<option key={session.id} value={session.id} title={session.tooltip}>
							{session.label}
						</option>
					))}
				</select>
				<details
					ref={menuRef}
					class="quick-skills-session-menu quick-skills-popover-menu"
					onToggle={() => {
						if (!menuRef.current?.open || !contentEl) {
							return;
						}
						closeOpenPopoverMenus(contentEl, menuRef.current);
						updatePopoverDirection(menuRef.current, contentEl, transcriptEl ?? undefined);
					}}
				>
					<summary
						ref={summaryRef}
						class="quick-skills-session-menu-trigger"
						aria-label="Session actions"
						title="Session actions"
					/>
					<div class="quick-skills-actions-popover quick-skills-session-menu-popover">
						<button
							class="quick-skills-actions-item"
							onClick={() => {
								const sessionId = activeSession?.id ?? plugin.activeSessionId;
								if (!sessionId) {
									return;
								}
								const initialName = activeSession?.title ?? "New session";
								new SessionRenameModal(plugin.app, initialName, async (nextName) => {
									await plugin.renameSession(sessionId, nextName);
								}).open();
								menuRef.current?.removeAttribute("open");
							}}
						>
							Rename
						</button>
						<button
							class="quick-skills-actions-item"
							onClick={() => {
								if (!plugin.activeSessionId) {
									return;
								}
								void plugin.archiveSession(plugin.activeSessionId);
								menuRef.current?.removeAttribute("open");
							}}
						>
							Archive
						</button>
					</div>
				</details>
				<button
					class="quick-skills-new-session-button"
					onClick={() => {
						void plugin.createAndSelectSession();
					}}
				>
					New
				</button>
			</div>
		</div>
	);
}

function TranscriptPane(props: {
	plugin: QuickSkillsPlugin;
	view: QuickSkillsView;
	messages: ChatMessage[];
	markdownSourcePath: string;
	transcriptRef: { current: HTMLDivElement | null };
	expandedActivityIds: Set<string>;
	collapsedActivityIds: Set<string>;
	setExpandedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
	setCollapsedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
	expandedReasoningMessageIds: Set<string>;
	onToggleReasoning: (messageId: string) => void;
	pendingScrollMessageId: string | null;
	onScrollHandled: () => void;
}) {
	const {
		plugin,
		view,
		messages,
		markdownSourcePath,
		transcriptRef,
		expandedActivityIds,
		collapsedActivityIds,
		setExpandedActivityIds,
		setCollapsedActivityIds,
		expandedReasoningMessageIds,
		onToggleReasoning,
		pendingScrollMessageId,
		onScrollHandled
	} = props;

	useEffect(() => {
		const transcriptEl = transcriptRef.current;
		if (!transcriptEl) {
			return;
		}
		if (pendingScrollMessageId) {
			const target = transcriptEl.querySelector<HTMLElement>(`.quick-skills-row[data-message-id="${pendingScrollMessageId}"]`);
			transcriptEl.scrollTop = target ? target.offsetTop - 8 : transcriptEl.scrollHeight;
			onScrollHandled();
			return;
		}
		transcriptEl.scrollTop = transcriptEl.scrollHeight;
	}, [messages, pendingScrollMessageId, transcriptRef, onScrollHandled]);

	return (
		<div ref={transcriptRef} class="quick-skills-transcript">
			{messages.map((message) => (
				<MessageRow
					key={message.id}
					plugin={plugin}
					view={view}
				message={message}
				markdownSourcePath={markdownSourcePath}
				expandedActivityIds={expandedActivityIds}
					collapsedActivityIds={collapsedActivityIds}
					setExpandedActivityIds={setExpandedActivityIds}
					setCollapsedActivityIds={setCollapsedActivityIds}
					traceExpanded={expandedReasoningMessageIds.has(message.id)}
					onToggleReasoning={() => {
						onToggleReasoning(message.id);
					}}
				/>
			))}
		</div>
	);
}

function MessageRow(props: {
	plugin: QuickSkillsPlugin;
	view: QuickSkillsView;
	message: ChatMessage;
	markdownSourcePath: string;
	expandedActivityIds: Set<string>;
	collapsedActivityIds: Set<string>;
	setExpandedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
	setCollapsedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
	traceExpanded: boolean;
	onToggleReasoning: () => void;
}) {
	const {
		plugin,
		view,
		message,
		markdownSourcePath,
		expandedActivityIds,
		collapsedActivityIds,
		setExpandedActivityIds,
		setCollapsedActivityIds,
		traceExpanded,
		onToggleReasoning
	} = props;
	const trace = getStoredTurnTrace(plugin, message);

	return (
		<div class={`quick-skills-row quick-skills-row-${message.role}`} data-message-id={message.id}>
			<div class={`quick-skills-bubble quick-skills-bubble-${message.role}`}>
				{metaLabelForMessage(message) ? (
					<div class="quick-skills-message-meta">{metaLabelForMessage(message)}</div>
				) : null}
				<div class="quick-skills-message-content markdown-rendered">
					{message.role === "assistant" ? (
						message.isStreaming ? (
							<div class="quick-skills-live-state">
								<TraceItems
									plugin={plugin}
									view={view}
									items={trace.items}
									markdownSourcePath={markdownSourcePath}
									expandedActivityIds={expandedActivityIds}
									collapsedActivityIds={collapsedActivityIds}
									setExpandedActivityIds={setExpandedActivityIds}
									setCollapsedActivityIds={setCollapsedActivityIds}
								/>
								<div class="quick-skills-live-state-status">
									<span class="quick-skills-live-state-label">{getStreamingStatusLabel(trace.items)}</span>
								</div>
							</div>
						) : (
							<div>
								{trace.items.length > 0 ? (
									<div
										class={`quick-skills-turn-trace-toggle${traceExpanded ? " is-expanded" : ""}`}
										role="button"
										tabindex={0}
										aria-expanded={traceExpanded ? "true" : "false"}
										onClick={onToggleReasoning}
										onKeyDown={(event) => {
											if (event.key !== "Enter" && event.key !== " ") {
												return;
											}
											event.preventDefault();
											onToggleReasoning();
										}}
									>
										<span class="quick-skills-turn-trace-rule" aria-hidden="true" />
										<span class="quick-skills-turn-trace-label">
											{trace.durationMs && Number.isFinite(trace.durationMs)
												? `Worked for ${formatDuration(trace.durationMs)}`
												: "Worked"}
										</span>
										<IconSpan icon={traceExpanded ? "chevron-down" : "chevron-right"} className="quick-skills-turn-trace-chevron" />
										<span class="quick-skills-turn-trace-rule" aria-hidden="true" />
									</div>
								) : null}
								{traceExpanded ? (
									<div>
										<div class="quick-skills-reasoning-panel">
											<TraceItems
												plugin={plugin}
												view={view}
												items={trace.items}
												markdownSourcePath={markdownSourcePath}
												expandedActivityIds={expandedActivityIds}
												collapsedActivityIds={collapsedActivityIds}
												setExpandedActivityIds={setExpandedActivityIds}
												setCollapsedActivityIds={setCollapsedActivityIds}
											/>
										</div>
										<div class="quick-skills-message-divider">
											<span class="quick-skills-message-divider-rule" aria-hidden="true" />
											<span class="quick-skills-message-divider-label">Final message</span>
											<span class="quick-skills-message-divider-rule" aria-hidden="true" />
										</div>
									</div>
								) : null}
								<div class="quick-skills-final-message">
									<MarkdownBlock
										app={plugin.app}
										sourcePath={markdownSourcePath}
										host={view}
										text={message.content}
										className="quick-skills-final-message-content markdown-rendered"
									/>
									<div class="quick-skills-message-actions-inline">
										<ActionIcon
											icon="copy"
											label="Copy message"
											onClick={async () => {
												await navigator.clipboard.writeText(message.content);
												new Notice("Assistant message copied.");
											}}
										/>
										<ActionIcon
											icon="file-pen"
											label="Insert at cursor"
											onClick={async () => {
												await plugin.insertIntoActiveNote(message.content, "cursor");
											}}
										/>
										<ActionIcon
											icon="file-plus"
											label="Append to note"
											onClick={async () => {
												await plugin.insertIntoActiveNote(message.content, "append");
											}}
										/>
									</div>
								</div>
							</div>
						)
					) : message.role === "skill" ? (
						<div class="quick-skills-skill-pill">
							<IconSpan icon="sparkles" className="quick-skills-skill-pill-icon" />
							<div class="quick-skills-skill-pill-copy">
								<div class="quick-skills-skill-pill-label">Skill</div>
								<div class="quick-skills-skill-pill-name">{message.skillName?.trim() || "Unnamed skill"}</div>
							</div>
							{message.activeNotePath?.trim() ? (
								<span class="quick-skills-skill-pill-meta">
									<IconSpan icon="file-text" className="quick-skills-skill-pill-meta-icon" />
									<span class="quick-skills-skill-pill-meta-label">{summarizeNotePath(message.activeNotePath)}</span>
								</span>
							) : null}
						</div>
					) : message.role === "error" ? (
						<pre class="quick-skills-message-plain">{message.content}</pre>
					) : (
						<MarkdownBlock app={plugin.app} sourcePath={markdownSourcePath} host={view} text={message.content} />
					)}
				</div>
			</div>
		</div>
	);
}

function TraceItems(props: {
	plugin: QuickSkillsPlugin;
	view: QuickSkillsView;
	items: ChatTraceItem[];
	markdownSourcePath: string;
	expandedActivityIds: Set<string>;
	collapsedActivityIds: Set<string>;
	setExpandedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
	setCollapsedActivityIds: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
}) {
	const {
		plugin,
		view,
		items,
		markdownSourcePath,
		expandedActivityIds,
		collapsedActivityIds,
		setExpandedActivityIds,
		setCollapsedActivityIds
	} = props;
	return (
		<>
			{items
				.filter((item) => !!item.activity || !!item.text?.trim())
				.map((item) => {
					if (item.kind === "activity" && item.activity) {
						const expanded = expandedActivityIds.has(item.activity.id) && !collapsedActivityIds.has(item.activity.id);
						return (
							<ActivityCard
								key={item.id}
								activity={item.activity}
								expanded={expanded}
								onToggle={(open) => {
									setExpandedActivityIds((current) => {
										const next = new Set(current);
										if (open) {
											next.add(item.activity!.id);
										} else {
											next.delete(item.activity!.id);
										}
										return next;
									});
									setCollapsedActivityIds((current) => {
										const next = new Set(current);
										if (open) {
											next.delete(item.activity!.id);
										} else {
											next.add(item.activity!.id);
										}
										return next;
									});
								}}
							/>
						);
					}
					return (
						<MarkdownBlock
							key={item.id}
							app={plugin.app}
							sourcePath={markdownSourcePath}
							host={view}
							text={item.text ?? ""}
							className={
								item.kind === "reasoning"
									? "quick-skills-trace-text quick-skills-trace-text-reasoning markdown-rendered"
									: "quick-skills-trace-text quick-skills-trace-text-message markdown-rendered"
							}
						/>
					);
				})}
		</>
	);
}

function ActivityCard(props: {
	activity: ChatActivity;
	expanded: boolean;
	onToggle: (open: boolean) => void;
}) {
	const { activity, expanded, onToggle } = props;
	const detailsRef = useRef<HTMLDetailsElement | null>(null);
	useEffect(() => {
		if (detailsRef.current) {
			detailsRef.current.open = expanded;
		}
	}, [expanded]);

	if (!activity.detail?.trim()) {
		return (
			<div class={`quick-skills-activity quick-skills-activity-${activity.status}`}>
				<ActivityHeader activity={activity} />
			</div>
		);
	}

	return (
		<details
			ref={detailsRef}
			class={`quick-skills-activity quick-skills-activity-${activity.status} quick-skills-activity-details`}
			onToggle={() => {
				onToggle(Boolean(detailsRef.current?.open));
			}}
		>
			<summary class="quick-skills-activity-summary">
				<IconSpan icon="chevron-right" className="quick-skills-activity-disclosure" />
				<ActivityHeader activity={activity} />
			</summary>
			<pre class="quick-skills-message-plain quick-skills-activity-detail">{activity.detail}</pre>
		</details>
	);
}

function ActivityHeader(props: { activity: ChatActivity }) {
	const { activity } = props;
	return (
		<span class="quick-skills-activity-header">
			<IconSpan icon={iconForActivity(activity.kind)} className="quick-skills-activity-icon" />
			<span class="quick-skills-activity-title" title={activity.title}>{activity.title}</span>
			<span class={`quick-skills-activity-status quick-skills-activity-status-${activity.status}`}>
				{labelForActivityStatus(activity.status)}
			</span>
		</span>
	);
}

function Composer(props: {
	plugin: QuickSkillsPlugin;
	input: string;
	onInputChange: (value: string) => void;
	controlsBlocked: boolean;
	applicableSkills: SkillDefinition[];
	contentEl: HTMLElement | null;
	transcriptEl: HTMLElement | null;
	dictation: DictationState;
	onSubmit: () => Promise<void>;
}) {
	const { plugin, input, onInputChange, controlsBlocked, applicableSkills, contentEl, transcriptEl, dictation, onSubmit } = props;
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const skillMenuRef = useRef<HTMLDetailsElement | null>(null);
	const skillSummaryRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (skillSummaryRef.current) {
			setIcon(skillSummaryRef.current, "sparkles");
		}
	}, []);

	return (
		<div class="quick-skills-composer">
			<textarea
				ref={inputRef}
				class="quick-skills-input"
				placeholder="Ask anything..."
				rows={1}
					aria-label="Prompt input"
					value={input}
					onInput={(event) => {
						onInputChange(event.currentTarget.value);
					}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						void onSubmit();
					}
				}}
			/>
			<div class="quick-skills-composer-toolbar">
				<div class="quick-skills-toolbar-actions">
					<button
						class={`quick-skills-toolbar-button quick-skills-toolbar-button-mic${dictation.state === "recording" ? " is-recording" : ""}${dictation.state === "transcribing" ? " is-transcribing" : ""}`}
						aria-label={dictation.state === "recording" ? "Stop dictation" : (dictation.state === "transcribing" ? "Transcribing..." : "Start dictation")}
						title={dictation.state === "recording" ? "Stop dictation" : (dictation.state === "transcribing" ? "Transcribing..." : "Start dictation")}
						disabled={plugin.isRunning || dictation.state === "transcribing"}
						onClick={() => {
							void dictation.toggle();
						}}
					>
						<IconSpan icon={dictation.state === "transcribing" ? "loader" : "mic"} />
					</button>
					<details
						ref={skillMenuRef}
						class="quick-skills-composer-skill-menu quick-skills-popover-menu"
						onToggle={() => {
							if (plugin.isRunning) {
								skillMenuRef.current?.removeAttribute("open");
								return;
							}
							if (!skillMenuRef.current?.open || !contentEl) {
								return;
							}
							closeOpenPopoverMenus(contentEl, skillMenuRef.current);
							updatePopoverDirection(skillMenuRef.current, contentEl, transcriptEl ?? undefined);
						}}
					>
						<summary
							ref={skillSummaryRef}
							class={`quick-skills-toolbar-button quick-skills-toolbar-button-skill${controlsBlocked ? " is-disabled" : ""}`}
							aria-label="Run skill"
							title="Run skill"
							aria-disabled={controlsBlocked ? "true" : "false"}
						/>
						<div class="quick-skills-actions-popover quick-skills-composer-skill-popover">
							{applicableSkills.length === 0 ? (
								<div class="quick-skills-actions-empty" aria-disabled="true">No skills for this note</div>
							) : applicableSkills.map((skill) => (
								<button
									key={skill.id}
									class="quick-skills-actions-item"
									onClick={() => {
										void plugin.runSkill(skill);
										skillMenuRef.current?.removeAttribute("open");
									}}
								>
									{skill.name}
								</button>
							))}
						</div>
					</details>
					<button
						class="quick-skills-toolbar-button quick-skills-toolbar-button-send"
						aria-label="Send prompt"
						title="Send prompt"
						disabled={controlsBlocked}
						hidden={plugin.isRunning}
						onClick={() => {
							void onSubmit();
						}}
					>
						<IconSpan icon="arrow-up" />
					</button>
					<button
						class="quick-skills-toolbar-button quick-skills-toolbar-button-stop"
						aria-label="Stop run"
						title="Stop run"
						hidden={!plugin.isRunning}
						onClick={() => {
							plugin.cancelCurrentRun();
						}}
					>
						<IconSpan icon="square" />
					</button>
				</div>
				<div class="quick-skills-toolbar-selects" hidden={dictation.state !== "idle"}>
					<CompactSelect
						label="Model"
						value={plugin.settings.selectedModel}
						options={plugin.getAvailableModels().map((model) => ({ value: model.id, label: model.label }))}
						onChange={(value) => {
							void plugin.setSelectedModel(value);
						}}
					/>
					<CompactSelect
						label="Reasoning"
						value={plugin.settings.selectedReasoningEffort}
						options={plugin.getReasoningOptionsForModel(plugin.settings.selectedModel).map((effort) => ({
							value: effort,
							label: formatReasoningLabel(effort)
						}))}
						onChange={(value) => {
							void plugin.setSelectedReasoningEffort(value);
						}}
					/>
					<CompactSelect
						label="Mode"
						value={plugin.settings.sandboxMode}
						options={plugin.getAvailableSandboxModes().map((mode) => ({
							value: mode,
							label: formatSandboxModeShortLabel(mode)
						}))}
						onChange={(value) => {
							void plugin.setSandboxMode(value as SandboxMode);
						}}
					/>
				</div>
				<div class="quick-skills-dictation-display" hidden={dictation.state === "idle"}>
					<div class="quick-skills-dictation-status">
						{dictation.state === "transcribing" ? "Transcribing audio..." : "Listening..."}
					</div>
					<div class="quick-skills-dictation-bars">
						{dictation.levels.map((level, index) => (
							<div
								key={index}
								class="quick-skills-dictation-bar"
								style={{ "--quick-skills-dictation-level": `${Math.max(0.12, level)}` }}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function CompactSelect(props: {
	label: string;
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (value: string) => void;
}) {
	const { label, value, options, onChange } = props;
	const selectedLabel = options.find((option) => option.value === value)?.label ?? label;
	const width = `calc(${Math.max(selectedLabel.length + 1, 5)}ch + 20px)`;
	return (
		<div class="quick-skills-toolbar-select-wrap" style={{ width }}>
			<select
				class="quick-skills-toolbar-select"
				aria-label={label}
				title={label}
				value={value}
				style={{ width }}
				onChange={(event) => {
					onChange(event.currentTarget.value);
				}}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>{option.label}</option>
				))}
			</select>
		</div>
	);
}

function MarkdownBlock(props: {
	app: QuickSkillsPlugin["app"];
	sourcePath: string;
	host: QuickSkillsView;
	text: string;
	className?: string;
}) {
	const { app, sourcePath, host, text, className } = props;
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		let cancelled = false;
		element.empty();
		void MarkdownRenderer.render(app, text, element, sourcePath, host).then(() => {
			if (cancelled) {
				element.empty();
			}
		});
		return () => {
			cancelled = true;
			element.empty();
		};
	}, [app, host, text]);

	return <div ref={ref} class={className ?? "markdown-rendered"} />;
}

function ActionIcon(props: { icon: string; label: string; onClick: () => Promise<void> }) {
	const { icon, label, onClick } = props;
	return (
		<span
			class="quick-skills-message-action-icon"
			role="button"
			tabIndex={0}
			aria-label={label}
			title={label}
			onClick={() => {
				void onClick();
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") {
					return;
				}
				event.preventDefault();
				void onClick();
			}}
		>
			<IconSpan icon={icon} />
		</span>
	);
}

function IconSpan(props: { icon: string; className?: string }) {
	const { icon, className } = props;
	const ref = useRef<HTMLSpanElement | null>(null);
	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, icon);
		}
	}, [icon]);
	return <span ref={ref} class={className} />;
}

interface DictationState {
	state: "idle" | "recording" | "transcribing";
	levels: number[];
	isBusy: boolean;
	toggle: () => Promise<void>;
}

function useDictation(plugin: QuickSkillsPlugin, setInput: (value: string | ((current: string) => string)) => void): DictationState {
	const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
	const [levels, setLevels] = useState<number[]>(Array.from({ length: 20 }, () => 0));
	const sessionRef = useRef<DictationSession | null>(null);

	useEffect(() => {
		return () => {
			void sessionRef.current?.abort();
			sessionRef.current = null;
		};
	}, []);

	const resetLevels = () => {
		setLevels(Array.from({ length: 20 }, () => 0));
	};

	return {
		state,
		levels,
		isBusy: state !== "idle",
		toggle: async () => {
			if (plugin.isRunning || state === "transcribing") {
				return;
			}
			if (state === "recording") {
				if (!sessionRef.current) {
					setState("idle");
					return;
				}
				setState("transcribing");
				try {
					const transcript = (await sessionRef.current.stopAndTranscribe()).trim();
					if (!transcript) {
						new Notice("No speech detected.");
					} else {
						setInput((current) => current.trim()
							? `${current.trimEnd()}\n\n${transcript}`
							: transcript);
					}
				} catch (error) {
					new Notice(getErrorMessage(error, "Voice dictation transcription failed."));
				} finally {
					sessionRef.current = null;
					setState("idle");
					resetLevels();
				}
				return;
			}

			try {
				resetLevels();
				const session = new DictationSession({
					baseUrl: plugin.settings.whisperBaseUrl,
					language: plugin.settings.whisperLanguage,
					timeoutMs: plugin.settings.whisperRequestTimeoutMs
				}, {
					onLevel: (level) => {
						setLevels((current) => [...current.slice(1), level]);
					}
				});
				sessionRef.current = session;
				await session.start();
				setState("recording");
			} catch (error) {
				sessionRef.current = null;
				setState("idle");
				new Notice(getErrorMessage(error, "Failed to start voice dictation."));
			}
		}
	};
}

function useAutosizeTextArea(value: string): void {
	useEffect(() => {
		const input = document.querySelector<HTMLTextAreaElement>(".quick-skills-input");
		if (!input) {
			return;
		}
		input.setCssProps({ "--quick-skills-input-height": "0px" });
		const height = Math.min(Math.max(input.scrollHeight, 40), 160);
		input.setCssProps({ "--quick-skills-input-height": `${height}px` });
	}, [value]);
}

function getStoredTurnTrace(plugin: QuickSkillsPlugin, message: ChatMessage): { items: ChatTraceItem[]; durationMs?: number } {
	const logTrace = getExecutionLogTrace(plugin, message);
	if (logTrace) {
		return logTrace;
	}

	const storedItems = (message.turnTrace?.items ?? [])
		.map((item) => ({
			id: item.id,
			kind: item.kind,
			text: item.text,
			activity: item.activity ? { ...item.activity } : undefined,
			isDraft: item.isDraft
		}))
		.filter((item) => !!item.activity || !!item.text?.trim());
	if (storedItems.length > 0) {
		return { items: storedItems, durationMs: message.turnTrace?.durationMs };
	}

	const items: ChatTraceItem[] = [];
	const reasoningText = message.turnTrace?.reasoningText?.trim() || message.reasoningTrace?.trim() || undefined;
	if (reasoningText) {
		items.push({ id: `${message.id}-reasoning`, kind: "reasoning", text: reasoningText });
	}
	for (const activity of message.turnTrace?.activities ?? []) {
		items.push({ id: activity.id, kind: "activity", activity });
	}
	for (const entry of (message.turnTrace?.completedMessages ?? []).slice(0, -1)) {
		if (!entry.trim()) {
			continue;
		}
		items.push({
			id: `${message.id}-message-${items.length}`,
			kind: "message",
			text: entry
		});
	}
	return { items, durationMs: message.turnTrace?.durationMs };
}

function getExecutionLogTrace(plugin: QuickSkillsPlugin, message: ChatMessage): { items: ChatTraceItem[]; durationMs?: number } | null {
	if (message.role !== "assistant" || message.isStreaming) {
		return null;
	}
	const executionLog = plugin.getExecutionLogForAssistantMessage(message);
	if (!executionLog || executionLog.rawEvents.length === 0) {
		return null;
	}
	const accumulator = new CodexStreamAccumulator();
	for (const rawEvent of executionLog.rawEvents) {
		const payload = rawEvent.payload;
		if (!payload || typeof payload !== "object" || typeof (payload as { type?: unknown }).type !== "string") {
			continue;
		}
		accumulator.apply(payload as never);
	}
	const items = accumulator.getLiveState().traceItems;
	if (items.length === 0) {
		return null;
	}
	return {
		items,
		durationMs: Number.isFinite(executionLog.durationMs) ? executionLog.durationMs : message.turnTrace?.durationMs
	};
}

function hasStoredTurnTrace(plugin: QuickSkillsPlugin, message: ChatMessage): boolean {
	return getStoredTurnTrace(plugin, message).items.length > 0;
}

function metaLabelForMessage(message: ChatMessage): string {
	if (message.role === "assistant" || message.role === "user" || message.role === "skill") {
		return "";
	}
	return `${message.role}${message.isStreaming ? " - running..." : ""}`;
}

function getStreamingStatusLabel(items: ChatTraceItem[]): string {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) {
			continue;
		}
		if (item.kind === "activity" && item.activity) {
			return item.activity.kind === "todo_list" ? "Updating plan" : "Using tools";
		}
		if (item.kind === "message") {
			return item.isDraft ? "Drafting response" : "Sharing progress";
		}
		if (item.kind === "reasoning") {
			return "Thinking";
		}
	}
	return "Working";
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) {
		return `${seconds}s`;
	}
	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}

function formatReasoningLabel(value: string): string {
	if (value === "xhigh") {
		return "X-high";
	}
	return value
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function formatSandboxModeShortLabel(mode: SandboxMode): string {
	if (mode === "read-only") {
		return "Read";
	}
	if (mode === "workspace-write") {
		return "Write";
	}
	return "Danger";
}

function summarizeNotePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		return "";
	}
	const segments = trimmed.split("/").filter((segment) => segment.length > 0);
	const fileName = segments[segments.length - 1] ?? trimmed;
	return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
}

function iconForActivity(kind: ChatActivity["kind"]): string {
	switch (kind) {
		case "command_execution":
			return "terminal";
		case "todo_list":
			return "list-todo";
		case "web_search":
			return "search";
		case "mcp_tool_call":
			return "plug";
		case "file_change":
			return "file-pen";
		case "error":
			return "alert-triangle";
		default:
			return "dot";
	}
}

function labelForActivityStatus(status: ChatActivity["status"]): string {
	if (status === "completed") {
		return "Done";
	}
	if (status === "failed") {
		return "Failed";
	}
	if (status === "info") {
		return "Updated";
	}
	return "Running";
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}
