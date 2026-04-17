import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Search, MessageSquare,
  Settings, Database, Zap, LogOut, MoreHorizontal, Pencil, Trash2,
} from 'lucide-react';

// ── Date grouping helper ──────────────────────────────────────────────────────
function getDateGroup(updatedAt) {
  const now    = new Date();
  const date   = new Date(updatedAt);
  const nowDay = new Date(now.getFullYear(),  now.getMonth(),  now.getDate());
  const day    = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff   = Math.round((nowDay - day) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7)  return 'This Week';
  return 'Older';
}

const DATE_GROUPS = ['Today', 'Yesterday', 'This Week', 'Older'];

// ── History item with context menu ───────────────────────────────────────────
function HistoryItem({ item, isActive, onSelect, onDelete, onRename, disabled }) {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [isRenaming,  setIsRenaming]  = useState(false);
  const [renameValue, setRenameValue] = useState(item.title);

  const menuRef  = useRef(null);
  const inputRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e) {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  // Focus input when rename mode activates
  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  function startRename() {
    setRenameValue(item.title);
    setIsRenaming(true);
    setMenuOpen(false);
  }

  function submitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item.title) onRename(item.id, trimmed);
    setIsRenaming(false);
  }

  function handleRenameKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); submitRename(); }
    if (e.key === 'Escape') { setIsRenaming(false); setRenameValue(item.title); }
  }

  function handleDelete() {
    setMenuOpen(false);
    if (window.confirm(`Delete "${item.title}"? This cannot be undone.`)) {
      onDelete(item.id);
    }
  }

  return (
    <li className="relative">
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-2 group transition-colors duration-100 ${
          isActive
            ? 'bg-indigo-600/20 border border-indigo-500/20'
            : disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-800 cursor-pointer'
        }`}
      >
        <MessageSquare
          size={14}
          className={`flex-shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}
        />

        {isRenaming ? (
          /* ── Inline rename input ── */
          <input
            ref={inputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKey}
            onBlur={submitRename}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-sm text-slate-200 focus:outline-none border-b border-indigo-400 pb-0.5"
          />
        ) : (
          /* ── Normal title ── */
          <div
            className="flex-1 min-w-0"
            onClick={() => !disabled && onSelect(item.id)}
          >
            <p className={`text-sm font-medium truncate ${
              isActive ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200'
            }`}>
              {item.title}
            </p>
          </div>
        )}

        {/* ·· Context‐menu trigger ·· */}
        {!isRenaming && (
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-all flex-shrink-0"
            title="Options"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {/* ── Dropdown menu ── */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-1 top-9 z-50 w-36 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1 animate-fade-in"
        >
          <button
            onClick={startRename}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Pencil size={13} />
            Rename
          </button>
          <div className="my-1 border-t border-slate-700/60" />
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

// ── Collapsed icon-only history item ─────────────────────────────────────────
function CollapsedHistoryItem({ item, isActive, onSelect, disabled }) {
  return (
    <li>
      <button
        onClick={() => !disabled && onSelect(item.id)}
        title={item.title}
        className={`flex items-center justify-center w-full p-2 rounded-lg transition-colors ${
          isActive
            ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/20'
            : disabled ? 'opacity-60 cursor-not-allowed text-slate-600' : 'text-slate-600 hover:bg-slate-800 hover:text-slate-400'
        }`}
      >
        <MessageSquare size={14} />
      </button>
    </li>
  );
}

// ── Footer button ─────────────────────────────────────────────────────────────
function SidebarFooterButton({ icon, label, collapsed }) {
  return (
    <button
      className={`flex items-center gap-2 w-full rounded-lg px-2 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-sm ${collapsed ? 'justify-center' : ''}`}
      title={label}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar({
  collapsed,
  onToggle,
  conversations,
  activeConvId,
  onNew,
  onSelect,
  onDelete,
  onRename,
  isLoading,
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group by date
  const grouped = {};
  for (const group of DATE_GROUPS) {
    grouped[group] = filtered.filter(c => getDateGroup(c.updated_at) === group);
  }

  return (
    <aside
      className={`flex flex-col flex-shrink-0 h-full bg-[#09090b]/80 backdrop-blur-xl border border-slate-800/60 rounded-2xl transition-all duration-300 ease-in-out relative z-10 shadow-2xl ${
        collapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* ── Header ── */}
      <div className="flex items-center h-16 px-4 border-b border-slate-800 flex-shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500 flex-shrink-0">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-semibold text-base text-white truncate">QueryFlow</span>
            <span className="ml-auto text-xs font-medium text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full flex-shrink-0">
              Beta
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center w-full">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500">
              <Zap size={16} className="text-white" />
            </div>
          </div>
        )}
      </div>

      {/* ── New Chat button ── */}
      <div className="px-3 py-3 flex-shrink-0">
        <button
          onClick={onNew}
          disabled={isLoading}
          className={`flex items-center gap-2 w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors duration-150 ${
            collapsed ? 'justify-center p-2' : 'px-3 py-2'
          }`}
          title="New Chat"
        >
          <Plus size={16} />
          {!collapsed && <span>New Chat</span>}
        </button>
      </div>

      {/* ── Search ── */}
      {!collapsed && (
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
            />
          </div>
        </div>
      )}

      {/* ── Conversation list ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-4 scrollbar-thin">
        {/* Expanded view — grouped by date */}
        {!collapsed && (
          conversations.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <MessageSquare size={24} className="text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-600">No conversations yet.</p>
              <p className="text-xs text-slate-700 mt-1">Send a message to start.</p>
            </div>
          ) : (
            DATE_GROUPS.map(group =>
              grouped[group].length > 0 ? (
                <div key={group}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-1">
                    {group}
                  </p>
                  <ul className="space-y-0.5">
                    {grouped[group].map(item => (
                      <HistoryItem
                        key={item.id}
                        item={item}
                        isActive={item.id === activeConvId}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        onRename={onRename}
                        disabled={isLoading}
                      />
                    ))}
                  </ul>
                </div>
              ) : null
            )
          )
        )}

        {/* Collapsed view — icon only */}
        {collapsed && (
          <ul className="space-y-0.5 pt-1">
            {conversations.map(item => (
              <CollapsedHistoryItem
                key={item.id}
                item={item}
                isActive={item.id === activeConvId}
                onSelect={onSelect}
                disabled={isLoading}
              />
            ))}
          </ul>
        )}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-slate-800 p-3 flex-shrink-0 space-y-1">
        <SidebarFooterButton icon={<Database size={16} />} label="Data Sources" collapsed={collapsed} />
        <SidebarFooterButton icon={<Settings size={16} />} label="Settings"     collapsed={collapsed} />
        <div className={`flex items-center gap-2 rounded-lg p-2 hover:bg-slate-800 cursor-pointer transition-colors group ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-teal-400 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            DA
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">Data Analyst</p>
              <p className="text-xs text-slate-500 truncate">analyst@company.com</p>
            </div>
          )}
          {!collapsed && <LogOut size={14} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0" />}
        </div>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 z-20 flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors shadow-lg"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed
          ? <ChevronRight size={12} className="text-slate-300" />
          : <ChevronLeft  size={12} className="text-slate-300" />}
      </button>
    </aside>
  );
}
