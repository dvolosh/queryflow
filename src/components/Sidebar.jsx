import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Search, MessageSquare,
  Settings, Database, Zap, LogOut, MoreHorizontal, Clock,
} from 'lucide-react';
import { CHAT_HISTORY } from '../data/mockData';

export default function Sidebar({ collapsed, onToggle }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = CHAT_HISTORY.filter(h =>
    h.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const grouped = {
    Today: filtered.filter(h => h.date === 'Today'),
    Yesterday: filtered.filter(h => h.date === 'Yesterday'),
    'This Week': filtered.filter(h => !['Today', 'Yesterday'].includes(h.date)),
  };

  return (
    <aside
      className={`flex flex-col flex-shrink-0 h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 ease-in-out relative z-10 ${
        collapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* Header */}
      <div className="flex items-center h-16 px-4 border-b border-slate-800 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500 flex-shrink-0">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-semibold text-base text-white truncate">QueryFlow</span>
            <span className="ml-auto text-xs font-medium text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full flex-shrink-0">Beta</span>
          </div>
        )}
        {collapsed && (
          <div className="flex items-center justify-center w-full">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-teal-500">
              <Zap size={16} className="text-white" />
            </div>
          </div>
        )}
      </div>

      {/* New Chat button */}
      <div className="px-3 py-3 flex-shrink-0">
        <button
          className={`flex items-center gap-2 w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors duration-150 ${
            collapsed ? 'justify-center p-2' : 'px-3 py-2'
          }`}
          title="New Chat"
        >
          <Plus size={16} />
          {!collapsed && <span>New Chat</span>}
        </button>
      </div>

      {/* Search */}
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

      {/* History groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-4 scrollbar-thin">
        {!collapsed && Object.entries(grouped).map(([group, items]) =>
          items.length > 0 ? (
            <div key={group}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-1">{group}</p>
              <ul className="space-y-0.5">
                {items.map(item => (
                  <HistoryItem key={item.id} item={item} collapsed={collapsed} />
                ))}
              </ul>
            </div>
          ) : null
        )}
        {collapsed && (
          <ul className="space-y-0.5 pt-1">
            {CHAT_HISTORY.map(item => (
              <HistoryItem key={item.id} item={item} collapsed={collapsed} />
            ))}
          </ul>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-slate-800 p-3 flex-shrink-0 space-y-1">
        <SidebarFooterButton icon={<Database size={16} />} label="Data Sources" collapsed={collapsed} />
        <SidebarFooterButton icon={<Settings size={16} />} label="Settings" collapsed={collapsed} />
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

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 z-20 flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 border border-slate-600 hover:bg-slate-600 transition-colors shadow-lg"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed
          ? <ChevronRight size={12} className="text-slate-300" />
          : <ChevronLeft size={12} className="text-slate-300" />
        }
      </button>
    </aside>
  );
}

function HistoryItem({ item, collapsed }) {
  return (
    <li>
      <button
        className={`flex items-center gap-2.5 w-full rounded-lg text-left transition-colors duration-100 group ${
          collapsed ? 'justify-center p-2' : 'px-2 py-2'
        } ${item.active
          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20'
          : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
        }`}
        title={item.title}
      >
        <MessageSquare size={14} className={`flex-shrink-0 ${item.active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.title}</p>
            <p className="text-xs text-slate-600 truncate">{item.preview}</p>
          </div>
        )}
        {!collapsed && (
          <MoreHorizontal size={14} className="opacity-0 group-hover:opacity-100 text-slate-500 flex-shrink-0 transition-opacity" />
        )}
      </button>
    </li>
  );
}

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
