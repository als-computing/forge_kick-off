import { useState } from 'react';
import { RouteItem } from '@/types/navigationRouterTypes';
import { cn } from '@/lib/utils';

export type TabSelectorPageProps = {
  routes: RouteItem[];
  onStart: (selectedPaths: string[]) => void;
  initialSelected?: string[];
};

export default function TabSelectorPage({ routes, onStart, initialSelected }: TabSelectorPageProps) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (initialSelected && initialSelected.length > 0) {
      return new Set(initialSelected);
    }
    return new Set(routes.map(r => r.path));
  });

  const toggleTab = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleStart = () => {
    if (selected.size === 0) return;
    onStart(Array.from(selected));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-900 via-sky-800 to-sky-950 flex items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            ALS Computing Hub
          </h1>
          <p className="text-xl text-sky-200">
            Select the tabs you want to see in your workspace
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {routes.map((route) => {
            const isSelected = selected.has(route.path);
            return (
              <button
                key={route.path}
                onClick={() => toggleTab(route.path)}
                className={cn(
                  'relative flex flex-col items-center justify-center p-6 rounded-xl',
                  'transition-all duration-200 transform hover:scale-105',
                  'border-2 min-h-[140px]',
                  isSelected
                    ? 'bg-sky-300/20 border-sky-300 shadow-lg shadow-sky-300/20'
                    : 'bg-white/5 border-white/20 hover:bg-white/10 hover:border-white/40'
                )}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-sky-300 rounded-full flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-sky-900"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <div className={cn(
                  'mb-3 transition-colors',
                  isSelected ? 'text-sky-300' : 'text-white/70'
                )}>
                  {route.icon}
                </div>
                <span className={cn(
                  'text-sm font-medium text-center transition-colors',
                  isSelected ? 'text-white' : 'text-white/70'
                )}>
                  {route.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-4">
          <div className="text-sky-200 text-sm">
            {selected.size} {selected.size === 1 ? 'tab' : 'tabs'} selected
          </div>
          <button
            type="button"
            onClick={handleStart}
            disabled={selected.size === 0}
            className={cn(
              'px-8 py-3 text-lg font-semibold rounded-lg transition-all',
              selected.size > 0
                ? 'bg-sky-300 text-sky-900 hover:bg-sky-200 shadow-lg shadow-sky-300/30'
                : 'bg-gray-500 text-gray-300 cursor-not-allowed'
            )}
          >
            Start Hub
          </button>
        </div>

        {selected.size === 0 && (
          <p className="text-center text-red-300 mt-4 text-sm">
            Please select at least one tab to continue
          </p>
        )}
      </div>
    </div>
  );
}
