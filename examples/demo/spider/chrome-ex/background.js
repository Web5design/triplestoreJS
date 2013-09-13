/* $Id$ */
var bg_res = {};
var expires = {};

function getRelatedSubjects(m, title, rdfa, micro) {
  var items = [];
  var MIN_SIMILARITY = 0.3;//0.5;
  var MIN_PROPS_LEN = 2 + 7;//at least 7
  var MAX_RESULT_SIZE =  10;
  
  function sanitize(items) {
    var i = 0;
    while(i < items.length) {
      var props = m.projections[items[i].subject].getProperties();
      if(props.length < MIN_PROPS_LEN) {
        items.splice(i, 1);
      } else {
        i++;
      }
    } 
  }
  
  //find similar items using site title
  if(title) {
    items = items.concat(m.getSimilarItems([title], MIN_SIMILARITY));
  }
  
  //private items RDFa refers to
  if(rdfa) {
    for(var subject in rdfa) {
      var itemValues = [];
      
      var props = rdfa[subject];
      for(var prop in props) {
        var value = props[prop];
        if(m.projections[value]) {//search with subject
          items.push({"subject": value,
            "similarity": 1.0});
        }
        if(prop.match(/name$/) ||
            prop.match(/title$/) ||
            prop == Manager.PROP_TITLE) {
          itemValues.push(value);
        }
      }
      items = items.concat(m.getSimilarItems(itemValues, MIN_SIMILARITY));
    }
  }
  //private items microdata refers to
  if(micro && micro.items) {
    for(var i = 0; i < micro.items.length; i++) {
      var item = micro.items[i];
      var props = item.properties;
      var itemValues = [];
      for(var prop in props) {
        var values = props[prop];

        for(var j = 0; j < values.length; j++) {
          var value = values[j];
          
          if(m.projections[value]) {//search with subject
            items.push({"subject": value,
              "similarity": 1.0});
          }
        }
        if(prop.match(/name$/) ||
            prop.match(/title$/) ||
            prop == Manager.PROP_TITLE) {
          itemValues = itemValues.concat(values);
        }
      }
      items = items.concat(m.getSimilarItems(itemValues, MIN_SIMILARITY));
    }
  }
  //TODO : referred : find in triplestore
  //for(var subject in m.projections) {
  //}
  
  sanitize(items);
  //sort by similarity with ascending
  items = items.sort(function(item1, item2) {
    return item2.similarity - item1.similarity;
  });
  
  //set subjects
  var subjects = [];
  for(var i = 0; i < items.length; i++) {
    subjects.push(items[i]["subject"]);
  }
  subjects = Manager.trimDuplicate(subjects);
  subjects = subjects.slice(0, MAX_RESULT_SIZE);
  
  return subjects;
}
function generateInsertedHTML(m, v, subjects, emailQuery) {
  if(!subjects.length) {
    return null;
  }
  $wrapper = $("<div>", {"id" : "spider-wrapper"});
  var $img = $("<img>", {"class" : "related_type", "src" : m.app_url + "images/spider.png"});
  $wrapper.append($("<div>", {"id" : "spider-visible"}).append($img));
  var $container = $("<div>", {"id" : "spider-container"}).appendTo($wrapper);
  
  var $items = $("<div id='spider-items'>").appendTo($container);
  var $summaries = $("<table>", {"id" : "spider-summaries"}).appendTo($items);
  for(var i = 0; i < subjects.length; i++) {
    var $summary = Viewer.getSubjectHTML(m, m.projections[subjects[i]], "referred_cell", true, emailQuery);
    $summaries.append($("<tr class='spider-summary'>").append($summary));
    
    var detail = v.getSummaryHTML(subjects[i], emailQuery);
    var $detail = null;
    if(detail) {
      $detail = $($(detail).find(".item-detail")[0]);
      $detail.find("ul").attr("style", "text-align:left;");//change the style of <ul>

      $items.append(
          $("<div>", {"class" : "spider-detail", "id" : $summary.attr("href")}).append($detail));
    }
  }
  return $("<div>").append($wrapper).html();
}
function getVisitNumber(url) {
  return localStorage[url] ? parseInt(localStorage[url]) : 0;
}
function countVisitNumber(url) {
  var num = localStorage[url] ? parseInt(localStorage[url]) : 0;
  if(num < 99) {
    localStorage[url] = num + 1;
  }
}
chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
      var m = bg_res.m;
      m.init(sender.tab);
      m.renew();
      
      if(request.action == "extracted") {
        if(!sender.tab || !sender.tab.id) {
          return;
        }
        //reset icon
        Viewer.changeIcon(sender.tab.id);
        //init
        var results = {};
        if(request.rdfa) {
          console.log("bg received RDFa");
          results.rdfa = request.rdfa;
        }
        if(request.micro) {
          console.log("bg received microdata");
          results.micro = request.micro;
        }
        if((request.rdfa && Manager.hasKey(request.rdfa)) ||
            (request.micro && request.micro.items.length)) {
          //notify the site has annotation
          var itemSize = Manager.getItemLen(request.rdfa);
          itemSize += Manager.getItemLen(request.micro.items);
          Viewer.changeIcon(sender.tab.id, String(itemSize));
        }
        results.expires = expires[request.url];
        results.onSelectionChanged = onSelectionChanged;
        bg_res[request.url] = results;
        countVisitNumber(request.url);
        
        //auto save the items based on visit number
        var visit = Options.get_visit();
        if(visit && getVisitNumber(request.url) >= visit * 3) {
          //alert("save by visit");
          m.save();
        }
      }
      //auto save for long stay at same site
      else if(request.action == "long-stay") {
        //alert("save by time");
        m.save();
      }
      //feedback related items to content script
      var subjects = getRelatedSubjects(m, request.title,
          bg_res[request.url].rdfa, bg_res[request.url].micro);
      
      var v = new Viewer(m, sender.tab);
      var html = generateInsertedHTML(m, v, subjects);
      var time = Options.get_time();
      sendResponse({html: html, time: time});
    }
);
function onSelectionChanged(tabId) {
  chrome.tabs.executeScript(tabId, {
    file: "content.js"
  });
}
/*chrome.tabs.onActivated.addListener(function(activeInfo) {
  onSelectionChanged(activeInfo.tabId);
});*/
chrome.tabs.onUpdated.addListener(function(id, changeInfo, tab) {
  onSelectionChanged(id);  
});

//get Expires header
chrome.webRequest.onResponseStarted.addListener(
    function(details) {
      var headers = details.responseHeaders;
      var ex = null;
      for(var i = 0; i < headers.length; i++) {
        if(headers[i].name.toLowerCase() == "expires") {
          ex = new Date(headers[i].value);
          break;
        }
      }
      expires[details.url] = ex;
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["responseHeaders"]
);
//clean expired items only once
function cleanOldItems(m) {
  var now = new Date();
  for(var subject in m.projections) {
    var projection = m.projections[subject];
    var expires_str = projection.get(Manager.PROP_EXPIRES);
    if(expires_str) {
      var expires = new Date(expires_str);
      if(expires < now) {
        projection.remove();
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var m = new Manager();
  m.init(null);
  m.renew();
  bg_res.m = m;
  if(Options.is_remove()) {
    cleanOldItems(m);
  }
});

//menu of sharing photos
//A generic onclick callback function.
function genericOnClick(info, tab) {
  console.log("item " + info.menuItemId + " was clicked");
  console.log("info: " + JSON.stringify(info));
  console.log("tab: " + JSON.stringify(tab));
    
  var pageURL = info.pageUrl;
  var email_subject = "Sharing ";
  var email_body = "";
  if(info.mediaType == "image" ||
      info.mediaType == "video" ||
      info.mediaType == "audio") {
    email_subject += "media";
    var srcURL = info.srcUrl;
    email_body = srcURL;
  } else if(info.linkUrl) {
    alert("share linkUrl!");
    email_subject += "URL";
    email_body = info.linkUrl;
  } else if(info.selectionText) {
    alert("share selectionText!");
    email_subject += "text";
    email_body = info.selectionText;
  }
  
  var m = bg_res.m;
  var v = new Viewer(m, tab);
  var subjects = m.filterSubjects(["mbox"]);
  
  if(subjects.length) {
    var emailQuery = "?"
      + ["subject=" + email_subject,
         "body=" + email_body].join("&");
    var html = generateInsertedHTML(m, v, subjects, emailQuery);
    
    chrome.tabs.sendMessage(tab.id,
        {"html": html},
        function(response) {
        });
  } else {
    alert("Sorry, could not find any person having email.");
  }
}
//new context menu
//Create a parent item and two children.
var menu_top = chrome.contextMenus.create(
    {title: "Semantic Spider",
      contexts: ["all"],
    });
var menu_share = chrome.contextMenus.create(
    {title: "share",
      parentId: menu_top,
      contexts: ["all"],
      onclick: genericOnClick});