import { useEffect } from 'react';
import './App.css';
import { ControlPanel } from './components/ControlPanel/ControlPanel';
import { Preview } from './components/Preview/Preview';
import { useToshiStore } from './state/store';

function App() {
  const setLogoImage = useToshiStore((s) => s.setLogoImage);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoImage(img);
    img.onerror = () => setLogoImage(null);
    img.src = '/branding/toshi-logo.png';
  }, [setLogoImage]);

  return (
    <div className="app-shell">
      <ControlPanel />
      <Preview />
    </div>
  );
}

export default App;
