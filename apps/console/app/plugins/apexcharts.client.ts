import VueApexCharts from 'vue3-apexcharts';
import 'apexcharts/dist/apexcharts.css';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('ApexChart', VueApexCharts);
});
