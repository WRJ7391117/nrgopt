(function(){
var t=localStorage.getItem('nrgopt-theme')||'dark';
document.documentElement.setAttribute('data-theme',t);
function updateThemeControl(theme){
var i=document.getElementById('themeIcon');
var b=document.getElementById('themeBtn');
if(i){if(theme==='light'){i.innerHTML='<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';}else{i.innerHTML='<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';}}
if(b){var label=theme==='dark'?'切换到浅色模式':'切换到深色模式';b.setAttribute('aria-label',label);b.title=label;}
}
window.toggleTheme=function(){
var h=document.documentElement;
var n=h.getAttribute('data-theme')==='dark'?'light':'dark';
h.setAttribute('data-theme',n);
localStorage.setItem('nrgopt-theme',n);
updateThemeControl(n);
};
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){updateThemeControl(t);});}else{updateThemeControl(t);}
})();
