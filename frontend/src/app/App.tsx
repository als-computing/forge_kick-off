import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router';
import './App.css';
//import HubAppLayout from '@/components/HubAppLayout';
import { HubAppLayout, Tab } from '@blueskyproject/finch';
import TabSelectorPage from './pages/TabSelectorPage';
import { useHubSelectedTabs } from '@/hooks/useHubSelectedTabs';
//import { RouteItem } from '@/types/navigationRouterTypes';
import { RouteItem } from '@blueskyproject/finch';
import { BrowsersIcon, GameControllerIcon } from '@phosphor-icons/react';
import BrowsePage from './pages/BrowsePage';
import ControlPage from './pages/ControlPage';
import CustomizePages from '@/components/CustomizePages';

const allRoutes: RouteItem[] = [
  {
    element: <BrowsePage />,
    path: '/browse',
    label: 'Browse',
    icon: <BrowsersIcon size={32} />,
  },
  {
    element: <ControlPage />,
    path: '/control',
    label: 'Control',
    icon: <GameControllerIcon size={32} />,
    isBackgroundTransparent: true,
  }
];

function App() {
  const { selectedPaths, setSelectedPaths } = useHubSelectedTabs();
  const [showTabSelector, setShowTabSelector] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleStartHub = (paths: string[]) => {
    setSelectedPaths(paths);
    setShowTabSelector(false);
    if (paths.length > 0) {
      navigate(paths[0]);
    }
  };

  const handleOpenTabSelector = () => {
    setShowTabSelector(true);
  };

  const filteredRoutes = selectedPaths !== null
    ? allRoutes.filter(route => selectedPaths.includes(route.path))
    : [];

  if (selectedPaths === null || showTabSelector || filteredRoutes.length === 0) {
    return (
      <TabSelectorPage
        routes={allRoutes}
        onStart={handleStartHub}
        initialSelected={selectedPaths ?? undefined}
      />
    );
  }

  if (location.pathname === '/' && !filteredRoutes.some(r => r.path === '/')) {
    return <Navigate to={filteredRoutes[0].path} replace />;
  }

  return (
    <>
      <HubAppLayout
        routes={filteredRoutes}
        //onOpenTabSelector={handleOpenTabSelector}
      />
      <CustomizePages
        routes={allRoutes}
        selectedPaths={selectedPaths || []}
        onSelectionChange={setSelectedPaths}
      />
    </>
  );
}

export default App;
