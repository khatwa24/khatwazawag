/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GroomRecord, BrideRecord, AdminStats, AIMatchRecord, Article, Book } from "./src/types";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = 3000;

// --- SUPABASE CONFIGURATION & HELPERS ---
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase environment variables (SUPABASE_URL, and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY) are not set.");
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false
      }
    });
  }
  return supabaseClient;
}

async function ensureProfileImagesBucket() {
  try {
    const supabase = getSupabase();
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      console.error("Error listing Supabase buckets:", listError);
      throw listError;
    }

    const bucketExists = buckets?.some((b: any) => b.name === "profile-images");
    if (!bucketExists) {
      console.log("Bucket 'profile-images' does not exist. Creating it now...");
      const { error: createError } = await supabase.storage.createBucket("profile-images", {
        public: false, // Private bucket as requested
        allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
        fileSizeLimit: 5 * 1024 * 1024 // 5MB limit
      });

      if (createError) {
        console.error("Error creating Supabase bucket 'profile-images':", createError);
        throw createError;
      }
      console.log("Bucket 'profile-images' created successfully.");
    }
  } catch (err: any) {
    console.error("Failed to ensure Supabase bucket exists:", err.message || err);
  }
}

async function signPhoto(photo: string | undefined): Promise<string> {
  if (!photo) return "";
  if (photo.startsWith("http")) return photo; // Already a full URL
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from("profile-images")
      .createSignedUrl(photo, 3600); // 1 hour signed URL
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    console.error("Error signing photo path:", photo, error);
  } catch (err) {
    console.error("Failed to sign photo URL for path:", photo, err);
  }
  return photo;
}

async function signUserPhoto<T extends { photo?: string }>(user: T): Promise<T> {
  if (user && user.photo) {
    const signed = await signPhoto(user.photo);
    return { ...user, photo: signed };
  }
  return user;
}

async function signUserList<T extends { photo?: string }>(list: T[]): Promise<T[]> {
  return Promise.all(list.map(user => signUserPhoto({ ...user })));
}

app.use(express.json());

const DATA_DIR = path.join(process.cwd(), "data");
const GROOMS_FILE = path.join(DATA_DIR, "grooms.json");
const BRIDES_FILE = path.join(DATA_DIR, "brides.json");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const BOOKS_FILE = path.join(DATA_DIR, "books.json");

// Ensure data directory and files exist with initial high-quality mock data
function initializeDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initial Grooms Mock Data
  const initialGrooms: GroomRecord[] = [
    {
      id: "g1",
      type: "groom",
      status: "جديد",
      registrationDate: "2026-06-25",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      firstName: "أحمد",
      age: 29,
      governorate: "القاهرة",
      city: "مصر الجديدة",
      education: "بكالوريوس هندسة",
      job: "مهندس برمجيات",
      maritalStatus: "أعزب",
      financialStatus: "جيد جداً",
      height: 178,
      smoking: "لا يدخن",
      religiosity: "أصلي بالتزام",
      readyIn6Months: "نعم",
      requiredSpecs: "ملتزمة، متدينة، سنها من ٢٢ إلى ٢٦، مؤهل عالي، هادئة الطباع ومن عائلة طيبة.",
      whatsapp: "+201012345678",
      preferredContact: "واتساب",
      selfDescription: "أعمل مهندس برمجيات في شركة برمجيات دولية، هادئ ومحب للاستقرار والهدوء العائلي، أحافظ على الصلاة في وقتها والحمد لله والسنن والفرائض.",
      adminCode: "1001",
      photo: "",
      additionalNotes: "لدي شقة جاهزة للزواج بمصر الجديدة، والحمد لله مستقر وظيفياً ومادياً."
    },
    {
      id: "g2",
      type: "groom",
      status: "نشط",
      registrationDate: "2026-06-26",
      createdAt: new Date().toISOString(),
      firstName: "محمد",
      age: 34,
      governorate: "الجيزة",
      city: "الدقي",
      education: "ماجستير طب أطفال",
      job: "طبيب أطفال",
      maritalStatus: "مطلق",
      financialStatus: "ممتاز",
      height: 182,
      smoking: "لا يدخن",
      religiosity: "أصلي السنن والفرائض",
      readyIn6Months: "نعم",
      requiredSpecs: "طبيبة أو صيدلانية، على خلق وتدين، تفضل السكن بالجيزة، سنها لا يتجاوز ٣٠ سنة.",
      whatsapp: "+201234567890",
      preferredContact: "واتساب",
      selfDescription: "طبيب أطفال شغوف بعملي وأسعى لبناء أسرة على كتاب الله وسنة رسوله، هادئ الطباع وأحب القراءة والسفر المنتظم.",
      adminCode: "1002",
      photo: "",
      additionalNotes: "مطلق بدون أطفال، عيادتي الخاصة بالدقي ولدي سكن خاص مهيأ بالكامل."
    },
    {
      id: "g3",
      type: "groom",
      status: "تم التواصل",
      registrationDate: "2026-06-24",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      firstName: "محمود",
      age: 27,
      governorate: "الإسكندرية",
      city: "سموحة",
      education: "بكالوريوس تجارة وإدارة أعمال",
      job: "محاسب بنكي",
      maritalStatus: "أعزب",
      financialStatus: "جيد",
      height: 175,
      smoking: "يدخن",
      religiosity: "أصلي بتقطع",
      readyIn6Months: "نعم",
      requiredSpecs: "مؤهل عالي، من الإسكندرية، غير مدخنة، تقدّر الحياة الأسرية ومتفهمة.",
      whatsapp: "+201122334455",
      preferredContact: "رابط تليجرام",
      selfDescription: "أعمل محاسب في بنك خاص بالإسكندرية، هادئ وأحب السفر وممارسة الرياضة والاهتمام بأسرتي.",
      adminCode: "1003",
      photo: "",
      additionalNotes: "أعمل ببنك خاص بالإسكندرية وأسعى لتأسيس أسرة صالحة في أقرب وقت."
    },
    {
      id: "g4",
      type: "groom",
      status: "خطوبة",
      registrationDate: "2026-06-23",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      firstName: "علي",
      age: 31,
      governorate: "الدقهلية",
      city: "المنصورة",
      education: "ليسانس آداب وتربية لغة إنجليزية",
      job: "مدرس لغة إنجليزية",
      maritalStatus: "أعزب",
      financialStatus: "متوسط",
      height: 170,
      smoking: "لا يدخن",
      religiosity: "أصلي بالتزام",
      readyIn6Months: "نعم",
      requiredSpecs: "ربة منزل أو معلمة، على خلق، من المنصورة أو ما حولها، محجبة.",
      whatsapp: "+201555667788",
      preferredContact: "واتساب",
      selfDescription: "مدرس لغة إنجليزية في مدرسة تجريبية بالمنصورة، هادئ وأحب القراءة وتعليم الأطفال، ملتزم بالصلوات الخمس في وقتها.",
      adminCode: "1004",
      photo: "",
      additionalNotes: "شخص هادئ وصبور ومستعد لتحمل المسؤولية الكاملة لبناء بيت مسلم."
    },
    {
      id: "g5",
      type: "groom",
      status: "جديد",
      registrationDate: "2026-06-26",
      createdAt: new Date().toISOString(),
      firstName: "عمر",
      age: 28,
      governorate: "الشرقية",
      city: "الزقازيق",
      education: "بكالوريوس صيدلة",
      job: "صيدلي حر",
      maritalStatus: "أعزب",
      financialStatus: "جيد جداً",
      height: 180,
      smoking: "لا يدخن",
      religiosity: "أصلي بالتزام",
      readyIn6Months: "نعم",
      requiredSpecs: "صيدلانية أو طبيبة، محجبة، سنها من ٢٢ إلى ٢٦، تقدّر العلم والعمل المنظم.",
      whatsapp: "+201099887766",
      preferredContact: "واتساب",
      selfDescription: "صيدلي حر بالزقازيق، طموح وأسعى للنجاح العملي وبناء أسرة صالحة على أسس المودة والرحمة والمبادئ الإسلامية الصافية.",
      adminCode: "1005",
      photo: "",
      additionalNotes: "أعمل في صيدليتي الخاصة بالزقازيق ومستعد لتأسيس العش الزوجي خلال أشهر قليلة."
    }
  ];

  // Initial Brides Mock Data
  const initialBrides: BrideRecord[] = [
    {
      id: "b1",
      type: "bride",
      status: "جديد",
      registrationDate: "2026-06-26",
      createdAt: new Date().toISOString(),
      firstName: "فاطمة",
      age: 24,
      governorate: "القاهرة",
      city: "مدينة نصر",
      education: "بكالوريوس طب وجراحة الفم والأسنان",
      job: "طبيبة أسنان",
      maritalStatus: "عزباء",
      height: 162,
      religiosity: "أصلي بالتزام",
      requiredSpecs: "طبيب أو مهندس، محترم، خلوق، يقدر المسؤولية، سنه لا يزيد عن ٣٢ سنة، ملتزم بالصلاة.",
      contactMethod: "واتساب",
      contactDetails: "+201088776655",
      preferredContact: "واتساب",
      selfDescription: "طبيبة أسنان، أرتدي الحجاب الملتزم والحمد لله، وأهتم جداً ببناء بيت على أسس شرعية يسوده الهدوء والتفاهم المتبادل.",
      adminCode: "2001",
      photo: "",
      additionalNotes: "أرتدي الحجاب الملتزم والحمد لله، وأهتم جداً ببناء بيت على أسس شرعية."
    },
    {
      id: "b2",
      type: "bride",
      status: "نشط",
      registrationDate: "2026-06-25",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      firstName: "سارة",
      age: 27,
      governorate: "الجيزة",
      city: "الشيخ زايد",
      education: "بكالوريوس فنون تطبيقية",
      job: "مصممة جرافيك",
      maritalStatus: "عزباء",
      height: 165,
      religiosity: "أصلي بالتزام",
      requiredSpecs: "شخص متعلم، خلوق، مستقر مادياً ووظيفياً، لا يدخن، يراعي الله ومستقر نفسياً.",
      contactMethod: "واتساب",
      contactDetails: "+201144332211",
      preferredContact: "واتساب",
      selfDescription: "أعمل في شركة تصميم دولية عن بُعد، محجبة وأحب التفاهم والنقاش الهادئ، وأهتم بالجانب الأخلاقي والالتزام بالصلاة.",
      adminCode: "2002",
      photo: "",
      additionalNotes: "أعمل في شركة تصميم دولية عن بُعد، محجبة وأحب التفاهم والنقاش الهادئ."
    },
    {
      id: "b3",
      type: "bride",
      status: "تم التواصل",
      registrationDate: "2026-06-24",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      firstName: "منى",
      age: 30,
      governorate: "الإسكندرية",
      city: "المنتزه",
      education: "بكالوريوس تربية رياض أطفال",
      job: "معلمة أطفال",
      maritalStatus: "مطلقة",
      height: 158,
      religiosity: "أصلي بالتزام",
      requiredSpecs: "شخص مسؤول وطيب القلب، يتقي الله فيّ، لا يشترط السن ولكن يفضل من الإسكندرية.",
      contactMethod: "فيسبوك",
      contactDetails: "https://facebook.com/mona.teacher.example",
      preferredContact: "رابط فيسبوك",
      selfDescription: "مطلقة بدون أطفال، هادئة الطباع وأتمنى تكوين أسرة مستقرة قائمة على المودة والرحمة ومراعاة حق الله بالالتزام بالصلاة.",
      adminCode: "2003",
      photo: "",
      additionalNotes: "مطلقة بدون أطفال، هادئة، وأتمنى تكوين أسرة مستقرة قائمة على المودة والرحمة."
    },
    {
      id: "b4",
      type: "bride",
      status: "جديد",
      registrationDate: "2026-06-26",
      createdAt: new Date().toISOString(),
      firstName: "ياسمين",
      age: 22,
      governorate: "الغربية",
      city: "طنطا",
      education: "طالبة بكلية الطب البشري",
      job: "طالبة بالفرقة الخامسة",
      maritalStatus: "عزباء",
      height: 160,
      religiosity: "أصلي السنن والفرائض",
      requiredSpecs: "ملتزم بالصلاة في المسجد، مثقف، من طنطا أو ما حولها، يفضل طبيب أو مهندس خلوق.",
      contactMethod: "واتساب",
      contactDetails: "+201222446688",
      preferredContact: "واتساب",
      selfDescription: "طالبة طب بشري بالمنصورة، أرتدي الخمار والحمد لله، وأهتم بطلب العلم والالتزام الديني الكامل وسن الزواج المناسب.",
      adminCode: "2004",
      photo: "",
      additionalNotes: "أرتدي الخمار والحمد لله، أرجو أن يكون شريك حياتي من عائلة طيبة ويحترم طلب العلم."
    },
    {
      id: "b5",
      type: "bride",
      status: "غير نشط",
      registrationDate: "2026-06-22",
      createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      firstName: "مريم",
      age: 26,
      governorate: "المنوفية",
      city: "شبين الكوم",
      education: "بكالوريوس هندسة معمارية",
      job: "مهندسة معمارية",
      maritalStatus: "عزباء",
      height: 167,
      religiosity: "أصلي بالتزام",
      requiredSpecs: "مهندس أو صاحب وظيفة محترمة، خلوق، يحترم المرأة ويقدر عملها كمهندسة.",
      contactMethod: "فيسبوك",
      contactDetails: "https://facebook.com/maryam.arch.example",
      preferredContact: "رابط فيسبوك",
      selfDescription: "مهندسة معمارية في مكتب استشاري بشبين الكوم، محجبة وأحب تنظيم الوقت وتنسيق المنزل وأسعى لبناء علاقة قائمة على الاحترام المتبادل.",
      adminCode: "2005",
      photo: "",
      additionalNotes: "أعمل في مكتب استشاري هندسي بشبين الكوم، محجبة وأهتم بالجانب الأخلاقي جداً."
    }
  ];

  // Initial Articles Mock Data
  const initialArticles: Article[] = [
    {
      id: "art1",
      title: "أسس اختيار شريك الحياة في الإسلام والزواج الشرعي السعيد",
      image: "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800&auto=format&fit=crop",
      content: "الزواج في الإسلام هو ميثاق غليظ يقوم على السكن والمودة والرحمة. واختيار شريك الحياة يعد الخطوة الأهم لبناء بيت مسلم مستقر ومستدام. يوصينا نبينا الكريم صلى الله عليه وسلم بالتركيز على الدين والخلق كمعيارين أساسيين: 'إذا جاءكم من ترضون دينه وخلقه فزوجوه'، والتركيز على ذات الدين للرجال: 'فاظفر بذات الدين تربت يداك'. يجب كذلك مراعاة التقارب الفكري والاجتماعي لتحقيق التفاهم المطلق وتجنب الخلافات المستمرة.",
      publishDate: "2026-06-25"
    },
    {
      id: "art2",
      title: "الخطبة الشرعية: الضوابط والأحكام الشرعية لتحقيق المودة",
      image: "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=800&auto=format&fit=crop",
      content: "تعتبر الخطبة وعداً بالزواج وليست زواجاً فعلياً، ومن ثم فإن للخاطب والمخطوبة حدوداً شرعية واضحة يجب مراعاتها لضمان بركة هذا الميثاق. يشرع الخروج في اللقاءات الشرعية بوجود المحرم، والتحدث في الأمور العامة التي تكشف ملامح الشخصية والأهداف من الزواج. يجب تجنب الخلوة أو تجاوز الحدود اللفظية أو المادية ليكون الزواج مباركاً ومحاطاً برضا الله سبحانه وتعالى.",
      publishDate: "2026-06-26"
    },
    {
      id: "art3",
      title: "سبيل المودة والرحمة وتجاوز عقبات السنة الأولى من الزواج",
      image: "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=800&auto=format&fit=crop",
      content: "السنة الأولى من الزواج هي مرحلة انتقالية هامة يجري فيها التوافق الفعلي واكتشاف الطباع اليومية للطرفين. يتطلب النجاح فيها قدراً كبيراً من التغاضي، والتفاهم، والصبر، ومبدأ الشورى داخل البيت. على الزوجين وضع مخافة الله أساساً لتعاملهما، وأن يدركا أن الاختلافات طبيعية ويمكن حلها بالحوار الهادئ دون إدخال الأطراف الخارجية إلا للضرورة القصوى.",
      publishDate: "2026-06-27"
    }
  ];

  // Initial Books Mock Data
  const initialBooks: Book[] = [
    {
      id: "book1",
      title: "تحفة العروس أو الزواج الإسلامي السعيد",
      coverImage: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800&auto=format&fit=crop",
      description: "كتاب رائع وقيم يتناول أحكام الزواج في الإسلام، وآداب الزفاف، وكيفية التعامل بين الزوجين لبناء أسرة سعيدة قائمة على أسس متينة من الشرع المطهر.",
      downloadUrl: "https://archive.org/details/TohafAtAros"
    },
    {
      id: "book2",
      title: "الزواج الإسلامي السعيد: ضوابط وحقوق",
      coverImage: "https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?w=800&auto=format&fit=crop",
      description: "دراسة شرعية مبسطة وموثقة للحقوق والواجبات المتبادلة بين الزوجين، ونصائح عملية لتجاوز خلافات البيوت المعاصرة بهدي السلف الصالح.",
      downloadUrl: "https://archive.org/details/IslamicHappyMarriage"
    }
  ];

  if (!fs.existsSync(GROOMS_FILE)) {
    fs.writeFileSync(GROOMS_FILE, JSON.stringify(initialGrooms, null, 2), "utf8");
  } else {
    // Self-heal: ensure existing entries have adminCode and selfDescription
    try {
      const current = JSON.parse(fs.readFileSync(GROOMS_FILE, "utf8"));
      let updated = false;
      current.forEach((g: any, index: number) => {
        if (!g.adminCode) {
          g.adminCode = (1001 + index).toString();
          updated = true;
        }
        if (g.selfDescription === undefined) {
          g.selfDescription = "أعمل بجد ومستعد لبناء بيت مسلم صالح يحافظ على الصلاة في وقتها.";
          updated = true;
        }
        if (!g.preferredContact) {
          g.preferredContact = "واتساب";
          updated = true;
        }
        if (g.religiosity === "ملتزم" || g.religiosity === "ملتزم جداً") {
          g.religiosity = "أصلي بالتزام";
          updated = true;
        } else if (g.religiosity === "متوسط التدين") {
          g.religiosity = "أصلي بتقطع";
          updated = true;
        }
      });
      if (updated) {
        fs.writeFileSync(GROOMS_FILE, JSON.stringify(current, null, 2), "utf8");
      }
    } catch (e) {}
  }

  if (!fs.existsSync(BRIDES_FILE)) {
    fs.writeFileSync(BRIDES_FILE, JSON.stringify(initialBrides, null, 2), "utf8");
  } else {
    // Self-heal: ensure existing entries have adminCode and selfDescription
    try {
      const current = JSON.parse(fs.readFileSync(BRIDES_FILE, "utf8"));
      let updated = false;
      current.forEach((b: any, index: number) => {
        if (!b.adminCode) {
          b.adminCode = (2001 + index).toString();
          updated = true;
        }
        if (b.selfDescription === undefined) {
          b.selfDescription = "فتاة خلوقة ومستعدة لتكوين أسرة قائمة على المودة والرحمة ومراعاة الصلاة.";
          updated = true;
        }
        if (!b.preferredContact) {
          b.preferredContact = "واتساب";
          updated = true;
        }
        if (b.religiosity === "ملتزمة" || b.religiosity === "ملتزمة جداً") {
          b.religiosity = "أصلي بالتزام";
          updated = true;
        } else if (b.religiosity === "متوسطة التدين") {
          b.religiosity = "أصلي بتقطع";
          updated = true;
        }
      });
      if (updated) {
        fs.writeFileSync(BRIDES_FILE, JSON.stringify(current, null, 2), "utf8");
      }
    } catch (e) {}
  }

  if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify(initialArticles, null, 2), "utf8");
  }

  if (!fs.existsSync(BOOKS_FILE)) {
    fs.writeFileSync(BOOKS_FILE, JSON.stringify(initialBooks, null, 2), "utf8");
  }
}

initializeDatabase();

// Helpers to read/write records
function getGrooms(): GroomRecord[] {
  try {
    const data = fs.readFileSync(GROOMS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveGrooms(data: GroomRecord[]) {
  fs.writeFileSync(GROOMS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getBrides(): BrideRecord[] {
  try {
    const data = fs.readFileSync(BRIDES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBrides(data: BrideRecord[]) {
  fs.writeFileSync(BRIDES_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getArticles(): Article[] {
  try {
    const data = fs.readFileSync(ARTICLES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveArticles(data: Article[]) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getBooks(): Book[] {
  try {
    const data = fs.readFileSync(BOOKS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBooks(data: Book[]) {
  fs.writeFileSync(BOOKS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Lazy loader for GoogleGenAI SDK to avoid crashing on start if API key is missing
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      }
    }
  });
}

// Structured Rule-Based Compatibility algorithm (fallback and initial state)
function calculateBaseScore(groom: GroomRecord, bride: BrideRecord): number {
  let score = 50; // Starting baseline

  // 1. Governorate Match (up to 20 points)
  if (groom.governorate === bride.governorate) {
    score += 20;
  }

  // 2. Age compatibility (up to 15 points)
  const ageDiff = groom.age - bride.age;
  if (ageDiff >= 2 && ageDiff <= 7) {
    score += 15;
  } else if (ageDiff >= 0 && ageDiff <= 1) {
    score += 12;
  } else if (ageDiff >= 8 && ageDiff <= 11) {
    score += 10;
  } else if (ageDiff < 0 && ageDiff >= -3) {
    score += 8;
  } else {
    score += 5;
  }

  // 3. Marital status compatibility (up to 15 points)
  if (groom.maritalStatus === "أعزب" && bride.maritalStatus === "عزباء") {
    score += 15;
  } else if (groom.maritalStatus !== "أعزب" && bride.maritalStatus !== "عزباء") {
    score += 15;
  } else {
    score += 10;
  }

  // 4. Religiosity alignment (up to 15 points)
  const gRel = groom.religiosity || "";
  const bRel = bride.religiosity || "";
  if (gRel === bRel) {
    score += 15;
  } else if (
    (gRel.includes("ملتزم") && bRel.includes("ملتزم")) ||
    (gRel.includes("متوسط") && bRel.includes("متوسط"))
  ) {
    score += 13;
  } else {
    score += 8;
  }

  // 5. Education compatibility (up to 15 points)
  const gEduHigh = groom.education.includes("بكالوريوس") || groom.education.includes("هندسة") || groom.education.includes("طب") || groom.education.includes("ماجستير") || groom.education.includes("ليسانس") || groom.education.includes("صيدلة");
  const bEduHigh = bride.education.includes("بكالوريوس") || bride.education.includes("هندسة") || bride.education.includes("طب") || bride.education.includes("ماجستير") || bride.education.includes("ليسانس") || bride.education.includes("صيدلة") || bride.education.includes("طالبة");
  if (gEduHigh === bEduHigh) {
    score += 15;
  } else {
    score += 10;
  }

  return Math.min(score, 95); // Cap rule-based score at 95%
}

const MATCHES_FILE = path.join(DATA_DIR, "matches.json");

// Self-healing function that reads match records, adds missing pairs, and filters deleted ones
function getMatches(): AIMatchRecord[] {
  try {
    const grooms = getGrooms();
    const brides = getBrides();
    let matches: AIMatchRecord[] = [];

    if (fs.existsSync(MATCHES_FILE)) {
      try {
        matches = JSON.parse(fs.readFileSync(MATCHES_FILE, "utf8"));
      } catch (e) {
        matches = [];
      }
    }

    let modified = false;

    // Check if there are any missing pairs and add them dynamically
    grooms.forEach(groom => {
      brides.forEach(bride => {
        const exists = matches.some(m => m.groomId === groom.id && m.brideId === bride.id);
        if (!exists) {
          const score = calculateBaseScore(groom, bride);
          matches.push({
            groomId: groom.id,
            brideId: bride.id,
            aiScore: score,
            aiAnalysis: `توافق مبدئي بناءً على تقارب السن والمحافظة (${groom.governorate}) والتناسب التعليمي والاجتماعي. يمكنك كمسؤول تشغيل \"التوفيق الذكي بالذكاء الاصطناعي\" للحصول على تحليل دلالي عميق للمواصفات المطلوبة وفهم الاهتمامات المشتركة بدقة.`,
            approvedByAdmin: false
          });
          modified = true;
        }
      });
    });

    // Clean up matches that refer to deleted grooms or brides
    const initialLen = matches.length;
    matches = matches.filter(m => 
      grooms.some(g => g.id === m.groomId) && 
      brides.some(b => b.id === m.brideId)
    );
    if (matches.length !== initialLen) {
      modified = true;
    }

    if (modified || !fs.existsSync(MATCHES_FILE)) {
      fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2), "utf8");
    }

    return matches;
  } catch (err) {
    console.error("Error inside getMatches:", err);
    return [];
  }
}

function saveMatches(data: AIMatchRecord[]) {
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Admin Auth Helper - we'll use a standard secure passcode via environment variable or default
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "admin2026";

// --- API ENDPOINTS ---

// Upload Profile Photo to Supabase Storage
app.post("/api/upload-photo", async (req, res) => {
  try {
    const { filename, mimeType, base64Data } = req.body;

    if (!filename || !mimeType || !base64Data) {
      return res.status(400).json({ success: false, error: "بيانات الملف غير مكتملة." });
    }

    // Validate extension
    const ext = filename.split('.').pop()?.toLowerCase();
    const allowed = ['jpg', 'jpeg', 'png', 'webp'];
    if (!ext || !allowed.includes(ext)) {
      return res.status(400).json({ success: false, error: "نوع الملف غير مدعوم. المسموح فقط: jpg, jpeg, png, webp" });
    }

    // Validate mime type
    const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMime.includes(mimeType)) {
      return res.status(400).json({ success: false, error: "نوع الملف غير مدعوم." });
    }

    // Validate size (5MB)
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: "حجم الصورة يتعدى الحد الأقصى (5 ميجابايت)." });
    }

    // Initialize Supabase and ensure bucket exists
    const supabase = getSupabase();
    await ensureProfileImagesBucket();

    // Create unique path
    const uniqueId = Math.random().toString(36).substring(2, 15) + "_" + Date.now();
    const uniquePath = `${uniqueId}.${ext}`;

    // Upload to storage
    const { data, error: uploadError } = await supabase.storage
      .from("profile-images")
      .upload(uniquePath, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadError) {
      console.error("Supabase Storage error details:", uploadError);
      return res.status(500).json({ success: false, error: `خطأ في خدمة Supabase: ${uploadError.message}` });
    }

    return res.json({
      success: true,
      path: uniquePath
    });
  } catch (err: any) {
    console.error("Upload handler crash:", err);
    return res.status(500).json({ success: false, error: err.message || "حدث خطأ غير متوقع أثناء الرفع." });
  }
});

// Register Groom
app.post("/api/grooms/register", (req, res) => {
  try {
    const grooms = getGrooms();
    const todayStr = new Date().toISOString().split("T")[0];
    
    // Generate unique 4-digit adminCode
    const existingCodes = grooms.map(g => g.adminCode);
    let code = Math.floor(1000 + Math.random() * 9000).toString();
    while (existingCodes.includes(code)) {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const newGroom: GroomRecord = {
      id: "g_" + Math.random().toString(36).substring(2, 11),
      type: "groom",
      status: "جديد",
      registrationDate: todayStr,
      createdAt: new Date().toISOString(),
      preferredContact: "واتساب",
      selfDescription: "",
      ...req.body,
      adminCode: req.body.adminCode || code,
      photo: req.body.photo || ""
    };

    grooms.push(newGroom);
    saveGrooms(grooms);
    res.json({ success: true, record: newGroom });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Register Bride
app.post("/api/brides/register", (req, res) => {
  try {
    const brides = getBrides();
    const todayStr = new Date().toISOString().split("T")[0];

    // Generate unique 4-digit adminCode
    const existingCodes = brides.map(b => b.adminCode);
    let code = Math.floor(1000 + Math.random() * 9000).toString();
    while (existingCodes.includes(code)) {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const newBride: BrideRecord = {
      id: "b_" + Math.random().toString(36).substring(2, 11),
      type: "bride",
      status: "جديد",
      registrationDate: todayStr,
      createdAt: new Date().toISOString(),
      preferredContact: "واتساب",
      selfDescription: "",
      ...req.body,
      adminCode: req.body.adminCode || code,
      photo: req.body.photo || ""
    };

    brides.push(newBride);
    saveBrides(brides);
    res.json({ success: true, record: newBride });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Authentication Check
app.post("/api/admin/login", (req, res) => {
  const { passcode } = req.body;
  if (passcode === ADMIN_PASSCODE) {
    res.json({ success: true, token: "admin_token_2026_authorized" });
  } else {
    res.status(401).json({ success: false, error: "رمز الدخول غير صحيح" });
  }
});

// Admin - Fetch Stats
app.get("/api/admin/stats", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const grooms = getGrooms();
  const brides = getBrides();

  // Calculate stats
  const groomsCount = grooms.length;
  const bridesCount = brides.length;

  // Daily registrations
  const dailyRegistrations: { [date: string]: number } = {};
  const allRecords = [...grooms, ...brides];
  allRecords.forEach(r => {
    const regDate = r.registrationDate || new Date(r.createdAt).toISOString().split("T")[0];
    dailyRegistrations[regDate] = (dailyRegistrations[regDate] || 0) + 1;
  });

  // Top Governorates
  const govCounts: { [gov: string]: number } = {};
  allRecords.forEach(r => {
    if (r.governorate) {
      govCounts[r.governorate] = (govCounts[r.governorate] || 0) + 1;
    }
  });
  const topGovernorates = Object.entries(govCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const stats: AdminStats = {
    groomsCount,
    bridesCount,
    dailyRegistrations,
    topGovernorates
  };

  res.json({ success: true, stats });
});

// Admin - Fetch Grooms
app.get("/api/admin/grooms", async (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }
  try {
    const list = await signUserList(getGrooms());
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin - Fetch Brides
app.get("/api/admin/brides", async (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }
  try {
    const list = await signUserList(getBrides());
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin - Update Groom Status / Details
app.put("/api/admin/grooms/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const { id } = req.params;
  const grooms = getGrooms();
  const idx = grooms.findIndex(g => g.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "لم يتم العثور على الملف" });
  }

  grooms[idx] = { ...grooms[idx], ...req.body };
  saveGrooms(grooms);
  res.json({ success: true, record: grooms[idx] });
});

// Admin - Update Bride Status / Details
app.put("/api/admin/brides/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const { id } = req.params;
  const brides = getBrides();
  const idx = brides.findIndex(b => b.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "لم يتم العثور على الملف" });
  }

  brides[idx] = { ...brides[idx], ...req.body };
  saveBrides(brides);
  res.json({ success: true, record: brides[idx] });
});

// Admin - Delete Groom
app.delete("/api/admin/grooms/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const { id } = req.params;
  let grooms = getGrooms();
  const initialLen = grooms.length;
  grooms = grooms.filter(g => g.id !== id);

  if (grooms.length === initialLen) {
    return res.status(404).json({ error: "لم يتم العثور على الملف" });
  }

  saveGrooms(grooms);
  res.json({ success: true });
});

// Admin - Delete Bride
app.delete("/api/admin/brides/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const { id } = req.params;
  let brides = getBrides();
  const initialLen = brides.length;
  brides = brides.filter(b => b.id !== id);

  if (brides.length === initialLen) {
    return res.status(404).json({ error: "لم يتم العثور على الملف" });
  }

  saveBrides(brides);
  res.json({ success: true });
});

// Admin - Fetch Matches
app.get("/api/admin/matches", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }
  res.json({ success: true, list: getMatches() });
});

// Admin - Trigger Gemini AI Matchmaking
app.post("/api/admin/matches/generate-ai", async (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  try {
    const grooms = getGrooms();
    const brides = getBrides();

    if (grooms.length === 0 || brides.length === 0) {
      return res.status(400).json({ error: "يجب وجود عرسان وعرائس مسجلين بالمنصة لإجراء المطابقة الدلالية." });
    }

    let ai;
    try {
      ai = getGeminiClient();
    } catch (err: any) {
      if (err.message === "GEMINI_API_KEY_MISSING") {
        return res.status(400).json({ 
          error: "لم يتم العثور على مفتاح API الخاص بـ Gemini. يرجى تهيئته أولاً في إعدادات المنصة (Secrets) لتفعيل التوافق الذكي بالذكاء الاصطناعي." 
        });
      }
      throw err;
    }

    // Filter only active/relevant entries to keep context neat
    const groomsPrompt = grooms.map(g => ({
      id: g.id,
      firstName: g.firstName,
      age: g.age,
      governorate: g.governorate,
      education: g.education,
      job: g.job,
      maritalStatus: g.maritalStatus,
      religiosity: g.religiosity,
      requiredSpecs: g.requiredSpecs,
      additionalNotes: g.additionalNotes || ""
    }));

    const bridesPrompt = brides.map(b => ({
      id: b.id,
      firstName: b.firstName,
      age: b.age,
      governorate: b.governorate,
      education: b.education,
      job: b.job,
      maritalStatus: b.maritalStatus,
      religiosity: b.religiosity,
      requiredSpecs: b.requiredSpecs,
      additionalNotes: b.additionalNotes || ""
    }));

    const prompt = `
    قم بتحليل ومطابقة قوائم العرسان والعرائس التالية دلالياً. احسب نسبة التوافق لكل ثنائي (بين 50 و 100) بناءً على توافق السن والمحافظة والتعليم والوظيفة ومستوى التدين، والأهم من ذلك: فهم المعنى والطباع والاهتمامات والأهداف الواردة في خانة "المواصفات المطلوبة" دلالياً وليس مجرد كلمات متطابقة.
    
    اكتب شرحاً دلالياً مقنعاً ورصيناً باللغة العربية الفصحى (في حقل aiAnalysis) يوضح نقاط القوة والتوافق الروحي والعملي والاجتماعي بين الطرفين بدقة ووضوح ومودة (2-3 جمل مفيدة).

    قائمة العرسان:
    ${JSON.stringify(groomsPrompt, null, 2)}

    قائمة العرائس:
    ${JSON.stringify(bridesPrompt, null, 2)}

    المخرجات يجب أن تكون بصيغة JSON تحتوي على مصفوفة "matches" حيث كل عنصر يحتوي على المعرفات ونسبة التوافق والتحليل الدلالي.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "أنت خبير توفيق وبناء أسرة مسلمة بالذكاء الاصطناعي لموقع مودة ورحمة. مهمتك هي تحليل المواصفات المكتوبة لقرين الحياة وفهم معاني النصوص دلالياً ومطابقة العرسان والعرائس بأدق شكل ممكن، مخرجاتك يجب أن تكون بصيغة JSON مطابقة تماماً للمخطط المطلوب.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  groomId: { type: Type.STRING },
                  brideId: { type: Type.STRING },
                  aiScore: { type: Type.INTEGER, description: "Compatibility percentage between 50 and 100 based on detailed specifications" },
                  aiAnalysis: { type: Type.STRING, description: "Detailed matching analysis in Arabic explaining why they are compatible (2-3 sentences)" }
                },
                required: ["groomId", "brideId", "aiScore", "aiAnalysis"]
              }
            }
          },
          required: ["matches"]
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("لم يتم تلقي استجابة صالحة من نموذج الذكاء الاصطناعي.");
    }

    const aiResult = JSON.parse(responseText.trim());
    const aiMatches: { groomId: string; brideId: string; aiScore: number; aiAnalysis: string }[] = aiResult.matches || [];

    // Load current matches to preserve approved and requested flags
    const currentMatches = getMatches();

    // Merge AI results with current matches, keeping approval status and request flags intact
    const updatedMatches = currentMatches.map(current => {
      const aiMatch = aiMatches.find(m => m.groomId === current.groomId && m.brideId === current.brideId);
      if (aiMatch) {
        return {
          ...current,
          aiScore: aiMatch.aiScore,
          aiAnalysis: aiMatch.aiAnalysis
        };
      }
      return current;
    });

    saveMatches(updatedMatches);
    res.json({ success: true, list: updatedMatches });

  } catch (error: any) {
    console.error("AI Matchmaking Error:", error);
    res.status(500).json({ success: false, error: error.message || "حدث خطأ أثناء إجراء التوافق الذكي." });
  }
});

// Admin - Toggle Approval
app.put("/api/admin/matches/toggle-approve", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالدخول" });
  }

  const { groomId, brideId } = req.body;
  const matches = getMatches();
  const idx = matches.findIndex(m => m.groomId === groomId && m.brideId === brideId);

  if (idx === -1) {
    return res.status(404).json({ error: "لم يتم العثور على المطابقة المطلوبة." });
  }

  matches[idx].approvedByAdmin = !matches[idx].approvedByAdmin;
  saveMatches(matches);
  res.json({ success: true, record: matches[idx] });
});

// --- MEMBER AUTHENTICATION & PORTAL ENDPOINTS ---

// Member Login
app.post("/api/user/login", async (req, res) => {
  try {
    const { gender, whatsapp, adminCode } = req.body;
    if (!whatsapp || !adminCode) {
      return res.status(400).json({ error: "رقم الهاتف والكود مطلوبان لتسجيل الدخول." });
    }

    const cleanNum = whatsapp.replace(/\D/g, "");
    const cleanCode = adminCode.trim();

    if (gender === "groom") {
      const grooms = getGrooms();
      const user = grooms.find(g => {
        const gClean = (g.whatsapp || "").replace(/\D/g, "");
        return (gClean.endsWith(cleanNum) || cleanNum.endsWith(gClean)) && g.adminCode === cleanCode;
      });
      if (user) {
        const signedUser = await signUserPhoto(user);
        return res.json({ success: true, type: "groom", user: signedUser });
      }
    } else {
      const brides = getBrides();
      const user = brides.find(b => {
        const bClean = (b.contactDetails || "").replace(/\D/g, "");
        return (bClean.endsWith(cleanNum) || cleanNum.endsWith(bClean)) && b.adminCode === cleanCode;
      });
      if (user) {
        const signedUser = await signUserPhoto(user);
        return res.json({ success: true, type: "bride", user: signedUser });
      }
    }

    return res.status(401).json({ error: "بيانات الدخول غير صحيحة. يرجى التحقق من رقم الهاتف والكود المدخل." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Member Update Profile
app.put("/api/user/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, updatedData } = req.body;

    if (!type || !updatedData) {
      return res.status(400).json({ error: "بيانات التعديل غير مكتملة." });
    }

    if (type === "groom") {
      const grooms = getGrooms();
      const idx = grooms.findIndex(g => g.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: "لم يتم العثور على الملف الشخصي." });
      }

      // Merge updated fields, preventing editing ID, Type, AdminCode or status
      grooms[idx] = {
        ...grooms[idx],
        ...updatedData,
        id: grooms[idx].id,
        type: "groom",
        status: grooms[idx].status,
        adminCode: grooms[idx].adminCode
      };

      saveGrooms(grooms);
      const signedUser = await signUserPhoto(grooms[idx]);
      return res.json({ success: true, user: signedUser });
    } else {
      const brides = getBrides();
      const idx = brides.findIndex(b => b.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: "لم يتم العثور على الملف الشخصي." });
      }

      brides[idx] = {
        ...brides[idx],
        ...updatedData,
        id: brides[idx].id,
        type: "bride",
        status: brides[idx].status,
        adminCode: brides[idx].adminCode
      };

      saveBrides(brides);
      const signedUser = await signUserPhoto(brides[idx]);
      return res.json({ success: true, user: signedUser });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Member - Dynamic Auto Compatibility Matching List
app.post("/api/user/my-matches", async (req, res) => {
  try {
    const { id, type } = req.body;
    if (!id || !type) {
      return res.status(400).json({ error: "الرقم التعريفي والنوع مطلوبان." });
    }

    const grooms = getGrooms();
    const brides = getBrides();
    const matches = getMatches();

    let userRecord: any;
    let oppositeList: any[];

    if (type === "groom") {
      userRecord = grooms.find(g => g.id === id);
      oppositeList = brides;
    } else {
      userRecord = brides.find(b => b.id === id);
      oppositeList = grooms;
    }

    if (!userRecord) {
      return res.status(404).json({ error: "لم يتم العثور على حساب العضو." });
    }

    // Filter opposite list to show only active / active-ish users
    const filteredOpposite = oppositeList.filter(item => item.status !== "غير نشط");

    const results = filteredOpposite.map(item => {
      let score = 50; // Starting baseline

      // 1. Governorate Match (20 points)
      if (userRecord.governorate === item.governorate) {
        score += 20;
      }

      // 2. Age compatibility (15 points)
      const ageDiff = type === "groom" ? userRecord.age - item.age : item.age - userRecord.age;
      if (ageDiff >= 2 && ageDiff <= 7) {
        score += 15;
      } else if (ageDiff >= 0 && ageDiff <= 1) {
        score += 12;
      } else if (ageDiff >= 8 && ageDiff <= 11) {
        score += 10;
      } else if (ageDiff < 0 && ageDiff >= -3) {
        score += 8;
      } else {
        score += 5;
      }

      // 3. Marital status compatibility (15 points)
      if (userRecord.maritalStatus === "أعزب" && item.maritalStatus === "عزباء") {
        score += 15;
      } else if (userRecord.maritalStatus !== "أعزب" && item.maritalStatus !== "عزباء") {
        score += 15;
      } else {
        score += 10;
      }

      // 4. Religiosity alignment (20 points)
      // choices: "لا أصلي" | "أصلي بتقطع" | "أصلي بالتزام" | "أصلي السنن والفرائض"
      if (userRecord.religiosity === item.religiosity) {
        score += 20;
      } else if (
        (userRecord.religiosity === "أصلي بالتزام" || userRecord.religiosity === "أصلي السنن والفرائض") &&
        (item.religiosity === "أصلي بالتزام" || item.religiosity === "أصلي السنن والفرائض")
      ) {
        score += 18;
      } else if (userRecord.religiosity === "أصلي بتقطع" || item.religiosity === "أصلي بتقطع") {
        score += 10;
      } else {
        score += 5;
      }

      // 5. Education level compatibility (15 points)
      const myHigh = (userRecord.education || "").includes("بكالوريوس") || (userRecord.education || "").includes("هندسة") || (userRecord.education || "").includes("طب") || (userRecord.education || "").includes("ماجستير") || (userRecord.education || "").includes("صيدلة");
      const opHigh = (item.education || "").includes("بكالوريوس") || (item.education || "").includes("هندسة") || (item.education || "").includes("طب") || (item.education || "").includes("ماجستير") || (item.education || "").includes("صيدلة") || (item.education || "").includes("طالبة");
      if (myHigh === opHigh) {
        score += 15;
      } else {
        score += 10;
      }

      // 6. Semantic keyword overlap in requirements and selfDescription (15 points)
      const myReq = (userRecord.requiredSpecs || "").toLowerCase();
      const myDesc = (userRecord.selfDescription || "").toLowerCase();
      const opReq = (item.requiredSpecs || "").toLowerCase();
      const opDesc = (item.selfDescription || "").toLowerCase();

      let wordMatches = 0;
      const matchWords = ["طبيب", "مهندس", "معلم", "محاسب", "ملتزم", "هدوء", "شقة", "عمل", "مؤهل", "عائلة", "صلاة", "خمار", "نقاب", "محجبة", "القاهرة"];
      matchWords.forEach(w => {
        if (myReq.includes(w) && opDesc.includes(w)) wordMatches++;
        if (opReq.includes(w) && myDesc.includes(w)) wordMatches++;
      });
      score += Math.min(wordMatches * 3, 15);

      const finalScore = Math.min(score, 98);

      // Find if there is an admin approved match or connection requests
      const matchRecord = type === "groom"
        ? matches.find(m => m.groomId === userRecord.id && m.brideId === item.id)
        : matches.find(m => m.groomId === item.id && m.brideId === userRecord.id);

      const approved = matchRecord ? matchRecord.approvedByAdmin : false;
      const requestedByGroom = matchRecord ? matchRecord.contactRequestedByGroom : false;
      const requestedByBride = matchRecord ? matchRecord.contactRequestedByBride : false;

      const requestedByMe = type === "groom" ? requestedByGroom : requestedByBride;
      const requestedByOpposite = type === "groom" ? requestedByBride : requestedByGroom;

      // Rule: Do NOT expose private details (whatsapp, contactDetails, photo) unless approved by admin or both requested
      const showPrivateDetails = approved || (requestedByGroom && requestedByBride);

      return {
        id: item.id,
        adminCode: item.adminCode,
        firstName: item.firstName,
        age: item.age,
        governorate: item.governorate,
        city: item.city,
        education: item.education,
        job: item.job,
        maritalStatus: item.maritalStatus,
        religiosity: item.religiosity,
        selfDescription: item.selfDescription || "لم يكتب وصفاً شخصياً بعد.",
        requiredSpecs: item.requiredSpecs,
        // Exclude contact details, photos, preferred contact if not authorized
        photo: showPrivateDetails ? (item.photo || "") : undefined,
        whatsapp: showPrivateDetails ? (item.whatsapp || item.contactDetails) : undefined,
        contactDetails: showPrivateDetails ? item.contactDetails : undefined,
        preferredContact: showPrivateDetails ? item.preferredContact : undefined,
        
        aiScore: matchRecord ? matchRecord.aiScore : finalScore,
        aiAnalysis: matchRecord ? matchRecord.aiAnalysis : `توافق آلي رائع بنسبة ${finalScore}% في التقارب العمري والجغرافي ومستوى الالتزام بالصلاة والتعليم.`,
        approvedByAdmin: approved,
        contactRequestedByGroom: requestedByGroom || false,
        contactRequestedByBride: requestedByBride || false,
        isMutuallyConnected: requestedByGroom && requestedByBride
      };
    });

    // Resolve private photos to signed URLs asynchronously
    const signedResults = await Promise.all(
      results.map(async (item) => {
        if (item.photo) {
          const signed = await signPhoto(item.photo);
          return { ...item, photo: signed };
        }
        return item;
      })
    );

    // Sort by compatibility score
    signedResults.sort((a, b) => b.aiScore - a.aiScore);

    res.json({ success: true, list: signedResults });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Member - Request Connection / Contact for Matches (Interactive)
app.post("/api/user/request-contact-new", (req, res) => {
  try {
    const { requesterId, targetId, requesterType } = req.body;
    if (!requesterId || !targetId || !requesterType) {
      return res.status(400).json({ error: "البيانات المطلوبة غير مكتملة." });
    }

    const grooms = getGrooms();
    const brides = getBrides();
    const matches = getMatches();

    const groomId = requesterType === "groom" ? requesterId : targetId;
    const brideId = requesterType === "bride" ? requesterId : targetId;

    let idx = matches.findIndex(m => m.groomId === groomId && m.brideId === brideId);

    if (idx === -1) {
      // Create a match record if it doesn't exist
      const groomRecord = grooms.find(g => g.id === groomId);
      const brideRecord = brides.find(b => b.id === brideId);
      if (!groomRecord || !brideRecord) {
        return res.status(404).json({ error: "لم يتم العثور على أحد الطرفين." });
      }

      const score = calculateBaseScore(groomRecord, brideRecord);
      const newMatch: AIMatchRecord = {
        groomId,
        brideId,
        aiScore: score,
        aiAnalysis: `توافق تلقائي فوري مبني على التقاطع الجغرافي والعمري والاجتماعي بنسبة ${score}%.`,
        approvedByAdmin: false,
        contactRequestedByGroom: requesterType === "groom",
        contactRequestedByBride: requesterType === "bride"
      };
      matches.push(newMatch);
      idx = matches.length - 1;
    } else {
      // Update existing record
      if (requesterType === "groom") {
        matches[idx].contactRequestedByGroom = true;
      } else {
        matches[idx].contactRequestedByBride = true;
      }
    }

    saveMatches(matches);
    res.json({ success: true, record: matches[idx] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// User Check Status & Approved Matches (For legacy compatibility)
app.post("/api/user/check-status", async (req, res) => {
  try {
    const { whatsapp, gender } = req.body;
    if (!whatsapp) {
      return res.status(400).json({ error: "رقم الواتساب مطلوب للتحقق." });
    }

    const cleanNum = whatsapp.replace(/\D/g, "");
    const grooms = getGrooms();
    const brides = getBrides();

    let userRecord: any;
    let type: "groom" | "bride" = gender || "groom";

    if (gender === "groom" || (!gender && grooms.some(g => g.whatsapp.replace(/\D/g, "").endsWith(cleanNum)))) {
      userRecord = grooms.find(g => g.whatsapp.replace(/\D/g, "").endsWith(cleanNum));
      type = "groom";
    }

    if (!userRecord && (gender === "bride" || !gender)) {
      userRecord = brides.find(b => b.contactDetails.replace(/\D/g, "").endsWith(cleanNum));
      type = "bride";
    }

    if (!userRecord) {
      return res.status(404).json({ error: "لم يتم العثور على أي استمارة مسجلة بهذا الرقم." });
    }

    const matches = getMatches();
    const approvedMatches = matches.filter(m => {
      const idMatch = type === "groom" ? m.groomId === userRecord.id : m.brideId === userRecord.id;
      return idMatch && m.approvedByAdmin;
    });

    const mappedMatches = approvedMatches.map(m => {
      const oppositeId = type === "groom" ? m.brideId : m.groomId;
      const oppositeRecord = type === "groom"
        ? brides.find(b => b.id === oppositeId)
        : grooms.find(g => g.id === oppositeId);

      if (!oppositeRecord) return null;

      return {
        groomId: m.groomId,
        brideId: m.brideId,
        oppositeId: oppositeRecord.id,
        firstName: oppositeRecord.firstName,
        age: oppositeRecord.age,
        governorate: oppositeRecord.governorate,
        city: oppositeRecord.city,
        education: oppositeRecord.education,
        job: oppositeRecord.job,
        maritalStatus: oppositeRecord.maritalStatus,
        religiosity: oppositeRecord.religiosity,
        selfDescription: oppositeRecord.selfDescription || "لم يكتب وصفاً شخصياً بعد.",
        requiredSpecs: oppositeRecord.requiredSpecs,
        height: oppositeRecord.height,
        aiScore: m.aiScore,
        aiAnalysis: m.aiAnalysis,
        partnerDetails: oppositeRecord,
        approvedByAdmin: m.approvedByAdmin,
        contactRequestedByGroom: m.contactRequestedByGroom || false,
        contactRequestedByBride: m.contactRequestedByBride || false
      };
    }).filter(Boolean);

    const signedUserRecord = await signUserPhoto(userRecord);

    const signedMappedMatches = await Promise.all(
      mappedMatches.map(async (m) => {
        if (!m) return null;
        if (m.partnerDetails) {
          const signedPartner = await signUserPhoto(m.partnerDetails);
          return {
            ...m,
            partnerDetails: signedPartner
          };
        }
        return m;
      })
    );

    res.json({
      success: true,
      type,
      profile: signedUserRecord,
      user: {
        id: signedUserRecord.id,
        firstName: signedUserRecord.firstName,
        status: signedUserRecord.status,
        registrationDate: signedUserRecord.registrationDate,
        governorate: signedUserRecord.governorate,
        age: signedUserRecord.age
      },
      matches: signedMappedMatches.filter(Boolean)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// User request contact (for legacy compatibility)
app.post("/api/user/request-contact", (req, res) => {
  try {
    const { groomId, brideId, requester } = req.body;
    const matches = getMatches();
    const idx = matches.findIndex(m => m.groomId === groomId && m.brideId === brideId);

    if (idx === -1) {
      return res.status(404).json({ error: "لم يتم العثور على المطابقة المعتمدة." });
    }

    if (requester === "groom") {
      matches[idx].contactRequestedByGroom = true;
    } else {
      matches[idx].contactRequestedByBride = true;
    }

    saveMatches(matches);
    res.json({ success: true, record: matches[idx] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// --- ARTICLES SECTION ENDPOINTS ---

// Get all articles
app.get("/api/articles", (req, res) => {
  res.json({ success: true, list: getArticles() });
});

// Add new article
app.post("/api/articles", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const articles = getArticles();
    const newArticle: Article = {
      id: "art_" + Math.random().toString(36).substring(2, 11),
      title: req.body.title,
      image: req.body.image || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800&auto=format&fit=crop",
      content: req.body.content,
      publishDate: new Date().toISOString().split("T")[0]
    };

    articles.push(newArticle);
    saveArticles(articles);
    res.json({ success: true, record: newArticle });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update article
app.put("/api/articles/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const { id } = req.params;
    const articles = getArticles();
    const idx = articles.findIndex(a => a.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "لم يتم العثور على المقال" });
    }

    articles[idx] = {
      ...articles[idx],
      ...req.body,
      id: articles[idx].id // keep id constant
    };

    saveArticles(articles);
    res.json({ success: true, record: articles[idx] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete article
app.delete("/api/articles/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const { id } = req.params;
    let articles = getArticles();
    const initialLen = articles.length;
    articles = articles.filter(a => a.id !== id);

    if (articles.length === initialLen) {
      return res.status(404).json({ error: "لم يتم العثور على المقال" });
    }

    saveArticles(articles);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// --- BOOKS SECTION ENDPOINTS ---

// Get all books
app.get("/api/books", (req, res) => {
  res.json({ success: true, list: getBooks() });
});

// Add new book
app.post("/api/books", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const books = getBooks();
    const newBook: Book = {
      id: "book_" + Math.random().toString(36).substring(2, 11),
      title: req.body.title,
      coverImage: req.body.coverImage || "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800&auto=format&fit=crop",
      description: req.body.description,
      downloadUrl: req.body.downloadUrl || "https://archive.org"
    };

    books.push(newBook);
    saveBooks(books);
    res.json({ success: true, record: newBook });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update book
app.put("/api/books/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const { id } = req.params;
    const books = getBooks();
    const idx = books.findIndex(b => b.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "لم يتم العثور على الكتاب" });
    }

    books[idx] = {
      ...books[idx],
      ...req.body,
      id: books[idx].id // keep id constant
    };

    saveBooks(books);
    res.json({ success: true, record: books[idx] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete book
app.delete("/api/books/:id", (req, res) => {
  const token = req.headers.authorization;
  if (token !== "admin_token_2026_authorized") {
    return res.status(401).json({ error: "غير مصرح بالإجراء" });
  }

  try {
    const { id } = req.params;
    let books = getBooks();
    const initialLen = books.length;
    books = books.filter(b => b.id !== id);

    if (books.length === initialLen) {
      return res.status(404).json({ error: "لم يتم العثور على الكتاب" });
    }

    saveBooks(books);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- VITE MIDDLEWARE ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
