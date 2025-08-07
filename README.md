# myfriendroze

A modern, responsive website for myfriendroze ceramics and succulents, built with Astro.

## 🌵 About

myfriendroze specializes in handcrafted ceramic planters and carefully curated succulents. This website showcases our products and tells the story of our passion for plants and pottery.

## 🚀 Tech Stack

- **Framework:** [Astro](https://astro.build/)
- **Styling:** CSS with custom properties and responsive design
- **Typography:** Noto Sans Display
- **Hosting:** Firebase Hosting
- **Deployment:** Automated with CI/CD scripts

## 📁 Project Structure

```
/
├── astro/                  # Main Astro application
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── layouts/        # Page layouts
│   │   ├── pages/          # Route pages
│   │   └── styles/         # Global styles
│   └── public/             # Static assets
├── dist/                   # Built files for deployment
├── deploy.js               # Automated deployment script
├── deploy.bat              # Windows deployment script
└── DEPLOYMENT.md           # Deployment documentation
```

## 🛠️ Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd myfriendroze
   ```

2. **Install dependencies:**
   ```bash
   cd astro
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Visit `http://localhost:4321`

### Building for Production

```bash
cd astro
npm run build
```

## 🚀 Deployment

This project includes automated deployment scripts for Firebase Hosting.

### Quick Deploy

```bash
node deploy.js
```

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## 🎨 Design Features

- **Responsive Design:** Mobile-first approach with breakpoints for tablet and desktop
- **Custom Color Scheme:** Warm, earthy tones reflecting the natural aesthetic
- **Typography:** Noto Sans Display for clean, modern readability
- **Interactive Elements:** Smooth animations and hover effects
- **Accessibility:** Semantic HTML and proper ARIA labels

## 📱 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is proprietary and confidential.

## 📞 Contact

For questions about this project, please contact the myfriendroze team.

---

Built with ❤️ for plant lovers everywhere 🌱
