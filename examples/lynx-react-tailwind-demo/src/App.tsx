import { useCallback, useState } from "@lynx-js/react";

import lynxLogo from "./assets/lynx-logo.png";
import "./tailwind.css";
import "./App.css";

type Tab = "messages" | "calls";

type Conversation = {
  name: string;
  message: string;
  time: string;
  tone: string;
  unread?: number;
  online?: boolean;
};

type Call = {
  name: string;
  detail: string;
  time: string;
  tone: string;
};

const conversations: Conversation[] = [
  {
    name: "Ava Williams",
    message: "The new build looks really good ✨",
    time: "09:42",
    tone: "bg-cyan-400",
    unread: 2,
    online: true,
  },
  {
    name: "LynxShip team",
    message: "Jordan: Simulator build is ready",
    time: "08:18",
    tone: "bg-violet-400",
    unread: 4,
  },
  {
    name: "Maya Chen",
    message: "Can we review the OTA flow today?",
    time: "Yesterday",
    tone: "bg-amber-400",
    online: true,
  },
  {
    name: "Noah Martin",
    message: "Voice message · 0:34",
    time: "Yesterday",
    tone: "bg-pink-400",
  },
];

const calls: Call[] = [
  {
    name: "Ava Williams",
    detail: "Incoming video call",
    time: "Today, 09:31",
    tone: "bg-cyan-400",
  },
  {
    name: "Maya Chen",
    detail: "Outgoing audio call · 12 min",
    time: "Yesterday, 16:20",
    tone: "bg-amber-400",
  },
  {
    name: "LynxShip team",
    detail: "Missed group call",
    time: "Monday, 11:04",
    tone: "bg-violet-400",
  },
];

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

export function App() {
  const [tab, setTab] = useState<Tab>("messages");
  const [activeConversation, setActiveConversation] = useState("Ava Williams");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [callState, setCallState] = useState<"idle" | "calling">("idle");
  const [notice, setNotice] = useState("All your conversations are up to date");

  const showMessages = useCallback(() => {
    "background only";
    setTab("messages");
    setCallState("idle");
  }, []);

  const showCalls = useCallback(() => {
    "background only";
    setTab("calls");
    setCallState("idle");
  }, []);

  const toggleSearch = useCallback(() => {
    "background only";
    setSearchOpen((value) => !value);
  }, []);

  const startMessage = useCallback(() => {
    "background only";
    setSentCount((value) => value + 1);
    setNotice("New message draft created");
  }, []);

  const openConversation = useCallback((name: string) => {
    "background only";
    setActiveConversation(name);
    setNotice(`Conversation with ${name} selected`);
  }, []);

  const startCall = useCallback((mode: "audio" | "video") => {
    "background only";
    setCallState("calling");
    setNotice(`${mode === "video" ? "Video" : "Audio"} call ready to start`);
  }, []);

  const endCall = useCallback(() => {
    "background only";
    setCallState("idle");
    setNotice("Call ended");
  }, []);

  return (
    <view className="screen">
      <view className="ambient-glow ambient-glow-one" />
      <view className="ambient-glow ambient-glow-two" />
      <view className="shell">
        <view className="topbar flex-row items-center justify-between">
          <view className="flex-row items-center">
            <view className="brand-mark mr-3 items-center justify-center rounded-2xl bg-mint">
              <image src={lynxLogo} className="brand-logo h-7 w-7 rounded-lg" />
            </view>
            <view>
              <text className="brand-name text-base font-extrabold text-slate-50">
                lynxchat
              </text>
              <text className="brand-caption mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
                shipped with LynxShip
              </text>
            </view>
          </view>
          <view
            className="icon-button h-11 w-11 items-center justify-center rounded-2xl bg-white/5"
            bindtap={toggleSearch}
            accessibility-element
            accessibility-label="Open search"
          >
            <text className="icon text-xl text-slate-100">⌕</text>
          </view>
        </view>

        {searchOpen && (
          <view className="search-bar mt-5 flex-row items-center rounded-2xl bg-panel px-4 py-3">
            <text className="mr-3 text-base text-slate-400">⌕</text>
            <text className="text-sm text-slate-400">Search conversations</text>
            <view className="flex-1" />
            <text className="text-xs font-semibold text-mint">ESC</text>
          </view>
        )}

        <view className="intro mt-8">
          <text className="eyebrow text-xs font-bold uppercase tracking-widest text-mint">
            Good evening, Jordan
          </text>
          <view className="mt-3 flex-row items-end justify-between">
            <text className="page-title text-4xl font-extrabold leading-tight text-slate-50">
              Messages
            </text>
            <view className="online-pill mb-1 flex-row items-center rounded-full bg-emerald-950 px-3 py-2">
              <view className="mr-2 h-2 w-2 rounded-full bg-mint" />
              <text className="text-xs font-bold text-mint">ONLINE</text>
            </view>
          </view>
          <text className="intro-copy mt-3 block text-sm leading-6 text-slate-400">
            Stay close to your people, wherever you ship.
          </text>
        </view>

        <view className="tabs mt-6 flex-row rounded-2xl bg-panel p-1">
          <view
            className={`tab flex-1 items-center rounded-xl px-4 py-3 ${tab === "messages" ? "tab-active" : ""}`}
            bindtap={showMessages}
            accessibility-element
            accessibility-label="Show messages"
          >
            <text
              className={`text-sm font-bold ${tab === "messages" ? "text-slate-50" : "text-slate-400"}`}
            >
              Messages
            </text>
            <text className="tab-count ml-2 rounded-full bg-mint px-2 py-1 text-xs font-extrabold text-ink">
              6
            </text>
          </view>
          <view
            className={`tab flex-1 items-center rounded-xl px-4 py-3 ${tab === "calls" ? "tab-active" : ""}`}
            bindtap={showCalls}
            accessibility-element
            accessibility-label="Show calls"
          >
            <text
              className={`text-sm font-bold ${tab === "calls" ? "text-slate-50" : "text-slate-400"}`}
            >
              Calls
            </text>
          </view>
        </view>

        <view className="notice mt-4 flex-row items-center rounded-2xl bg-mint/10 px-4 py-3">
          <text className="mr-3 text-base text-mint">✦</text>
          <text className="flex-1 text-xs font-semibold text-slate-300">
            {notice}
          </text>
          {sentCount > 0 && (
            <text className="text-xs font-bold text-mint">+{sentCount}</text>
          )}
        </view>

        {tab === "messages" ? (
          <view className="messages-section mt-5">
            <view className="section-heading flex-row items-center justify-between">
              <text className="text-lg font-bold text-slate-50">
                Recent chats
              </text>
              <text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                See all
              </text>
            </view>
            <scroll-view
              className="conversation-scroll mt-3"
              scroll-orientation="vertical"
            >
              {conversations.map((conversation) => (
                <view
                  className={`message-card mb-3 flex-row items-center rounded-2xl bg-panel px-4 py-4 ${activeConversation === conversation.name ? "message-card-active" : ""}`}
                  bindtap={() => openConversation(conversation.name)}
                  key={conversation.name}
                  accessibility-element
                  accessibility-label={`Open conversation with ${conversation.name}`}
                >
                  <view
                    className={`avatar mr-3 h-12 w-12 items-center justify-center rounded-2xl ${conversation.tone}`}
                  >
                    <text className="text-sm font-extrabold text-ink">
                      {initials(conversation.name)}
                    </text>
                    {conversation.online && (
                      <view className="avatar-online h-3 w-3 rounded-full bg-mint" />
                    )}
                  </view>
                  <view className="min-w-0 flex-1">
                    <view className="flex-row items-center justify-between">
                      <text className="conversation-name text-sm font-bold text-slate-50">
                        {conversation.name}
                      </text>
                      <text className="text-xs text-slate-500">
                        {conversation.time}
                      </text>
                    </view>
                    <view className="mt-2 flex-row items-center justify-between">
                      <text className="conversation-preview flex-1 text-xs text-slate-400">
                        {conversation.message}
                      </text>
                      {conversation.unread && (
                        <text className="ml-2 rounded-full bg-mint px-2 py-1 text-xs font-extrabold text-ink">
                          {conversation.unread}
                        </text>
                      )}
                    </view>
                  </view>
                </view>
              ))}
            </scroll-view>
            <view className="composer mt-2 rounded-2xl bg-panelStrong px-4 py-4">
              <view className="flex-row items-center justify-between">
                <view>
                  <text className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Selected chat
                  </text>
                  <text className="mt-2 text-sm font-bold text-slate-50">
                    {activeConversation}
                  </text>
                </view>
                <view className="flex-row">
                  <view
                    className="small-action mr-2 h-11 w-11 items-center justify-center rounded-xl bg-white/5"
                    bindtap={startMessage}
                    accessibility-element
                    accessibility-label="Attach a file"
                  >
                    <text className="text-lg text-slate-200">＋</text>
                  </view>
                  <view
                    className="send-action h-11 w-11 items-center justify-center rounded-xl bg-mint"
                    bindtap={startMessage}
                    accessibility-element
                    accessibility-label="Send message"
                  >
                    <text className="text-lg font-extrabold text-ink">➤</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        ) : (
          <view className="calls-section mt-5">
            <view className="call-hero rounded-3xl bg-panel px-5 py-5">
              <view className="flex-row items-start justify-between">
                <view>
                  <text className="eyebrow text-xs font-bold uppercase tracking-widest text-mint">
                    Private calls
                  </text>
                  <text className="mt-3 block text-2xl font-extrabold leading-tight text-slate-50">
                    Make time for the people who matter.
                  </text>
                </view>
                <text className="call-wave text-3xl text-violet-300">)))</text>
              </view>
              <view className="mt-5 flex-row">
                <view
                  className={`call-button mr-3 flex-1 items-center rounded-2xl px-3 py-3 ${callState === "calling" ? "bg-rose-400" : "bg-mint"}`}
                  bindtap={
                    callState === "calling" ? endCall : () => startCall("audio")
                  }
                  accessibility-element
                  accessibility-label={
                    callState === "calling" ? "End call" : "Start audio call"
                  }
                >
                  <text className="text-base font-extrabold text-ink">
                    {callState === "calling" ? "End call" : "Audio"}
                  </text>
                </view>
                <view
                  className="call-button flex-1 items-center rounded-2xl bg-violet-300 px-3 py-3"
                  bindtap={() => startCall("video")}
                  accessibility-element
                  accessibility-label="Start video call"
                >
                  <text className="text-base font-extrabold text-ink">
                    Video
                  </text>
                </view>
              </view>
            </view>

            <view className="section-heading mt-6 flex-row items-center justify-between">
              <text className="text-lg font-bold text-slate-50">
                Call history
              </text>
              <text className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3 calls
              </text>
            </view>
            <view className="mt-3">
              {calls.map((call) => (
                <view
                  className="call-row mb-3 flex-row items-center rounded-2xl bg-panel px-4 py-4"
                  key={`${call.name}-${call.time}`}
                >
                  <view
                    className={`avatar mr-3 h-12 w-12 items-center justify-center rounded-2xl ${call.tone}`}
                  >
                    <text className="text-sm font-extrabold text-ink">
                      {initials(call.name)}
                    </text>
                  </view>
                  <view className="flex-1">
                    <text className="text-sm font-bold text-slate-50">
                      {call.name}
                    </text>
                    <text className="mt-2 text-xs text-slate-400">
                      {call.detail}
                    </text>
                  </view>
                  <view className="items-end">
                    <text className="text-xs text-slate-500">{call.time}</text>
                    <view
                      className="call-back mt-2 items-center rounded-xl bg-white/5 px-3 py-2"
                      bindtap={() => startCall("audio")}
                      accessibility-element
                      accessibility-label={`Call ${call.name}`}
                    >
                      <text className="text-xs font-bold text-mint">
                        Call back
                      </text>
                    </view>
                  </view>
                </view>
              ))}
            </view>
          </view>
        )}

        <view className="bottom-nav mt-6 flex-row items-center justify-between rounded-2xl bg-panel px-4 py-3">
          <view
            className="nav-item nav-item-active items-center"
            bindtap={showMessages}
            accessibility-element
            accessibility-label="Messages home"
          >
            <text className="text-lg text-mint">▰</text>
            <text className="mt-1 text-xs font-bold text-slate-50">Inbox</text>
          </view>
          <view
            className="nav-item items-center"
            bindtap={showCalls}
            accessibility-element
            accessibility-label="Calls home"
          >
            <text className="text-lg text-slate-500">◉</text>
            <text className="mt-1 text-xs font-bold text-slate-500">Calls</text>
          </view>
          <view
            className="new-button h-12 w-12 items-center justify-center rounded-2xl bg-mint"
            bindtap={startMessage}
            accessibility-element
            accessibility-label="Start new message"
          >
            <text className="text-2xl font-light text-ink">＋</text>
          </view>
          <view
            className="nav-item items-center"
            bindtap={toggleSearch}
            accessibility-element
            accessibility-label="Search"
          >
            <text className="text-lg text-slate-500">⌕</text>
            <text className="mt-1 text-xs font-bold text-slate-500">
              Search
            </text>
          </view>
          <view
            className="nav-item items-center"
            bindtap={() => startCall("video")}
            accessibility-element
            accessibility-label="Profile"
          >
            <text className="text-lg text-slate-500">●</text>
            <text className="mt-1 text-xs font-bold text-slate-500">
              Profile
            </text>
          </view>
        </view>
      </view>
    </view>
  );
}
