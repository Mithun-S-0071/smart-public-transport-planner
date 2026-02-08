document.addEventListener("DOMContentLoaded", () => {
  // === Theme toggle ===
  const themeSwitch = document.getElementById("themeSwitch");
  const userTheme = localStorage.getItem("theme");

  if (userTheme === "dark") {
    document.body.classList.add("dark");
    themeSwitch.checked = true;
  }

  themeSwitch.addEventListener("change", () => {
    document.body.classList.toggle("dark", themeSwitch.checked);
    localStorage.setItem("theme", themeSwitch.checked ? "dark" : "light");
  });

  // === Section & Modal Elements ===
  const landing = document.getElementById("landing");
  const mapSection = document.getElementById("mapSection");
  const viewTrafficBtn = document.getElementById("viewTrafficBtn");
  const backBtn = document.getElementById("backBtn");
  const aboutBtn = document.getElementById("aboutBtn");
  const aboutModal = document.getElementById("aboutModal");
  const closeAbout = document.getElementById("closeAbout");

  // ✅ FIXED MAP OPEN CLICK
  viewTrafficBtn.addEventListener("click", () => {
    landing.style.display = "none";
    mapSection.classList.remove("hidden");
    initMap();
  });

  backBtn.addEventListener("click", () => {
    mapSection.classList.add("hidden");
    landing.style.display = "flex";
  });

  // === About Modal ===
  aboutBtn.addEventListener("click", () => {
    aboutModal.classList.remove("hidden");
  });

  closeAbout.addEventListener("click", () => {
    aboutModal.classList.add("hidden");
  });

  window.addEventListener("click", (event) => {
    if (event.target === aboutModal) {
      aboutModal.classList.add("hidden");
    }
  });

});
