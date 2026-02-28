import { useAppStore } from './store/index.js'
import { HomeScreen } from './components/HomeScreen/index.js'
import { ProjectWorkspace } from './components/ProjectWorkspace/index.js'

export default function App() {
  const currentView = useAppStore(s => s.currentView)
  return currentView === 'home' ? <HomeScreen /> : <ProjectWorkspace />
}
