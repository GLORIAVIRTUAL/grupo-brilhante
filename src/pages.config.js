/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Admin from './pages/Admin';
import Campanhas from './pages/Campanhas';
import CampanhasRede from './pages/CampanhasRede';
import Chat from './pages/Chat';
import ChatCustomers from './pages/ChatCustomers';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Dispatches from './pages/Dispatches';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Management from './pages/Management';
import Orders from './pages/Orders';
import PaymentSuccess from './pages/PaymentSuccess';
import Pickups from './pages/Pickups';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Trafego from './pages/Trafego';
import TrafegoGoogle from './pages/TrafegoGoogle';
import registerUnit from './pages/register-unit';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Admin": Admin,
    "Campanhas": Campanhas,
    "CampanhasRede": CampanhasRede,
    "Chat": Chat,
    "ChatCustomers": ChatCustomers,
    "Customers": Customers,
    "Dashboard": Dashboard,
    "Dispatches": Dispatches,
    "Home": Home,
    "Landing": Landing,
    "Management": Management,
    "Orders": Orders,
    "PaymentSuccess": PaymentSuccess,
    "Pickups": Pickups,
    "Reports": Reports,
    "Settings": Settings,
    "Trafego": Trafego,
    "trafegogoogle": TrafegoGoogle,
    "register-unit": registerUnit,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};