/* $Id$ */
var bg_res = {};
var expires = {};

function getRelatedSubjects(m, rdfa, micro) {
  var res = [];
  
  //private items RDFa refers to
  if(rdfa) {
    for(var subject in rdfa) {
      var props = rdfa[subject];
      for(var prop in props) {
        var value = props[prop];
        
        if(m.projections[value]) {//search with subject
          res.push(value);
        } else if(prop.search(/#?name$/) != -1
            ||prop.search(/#?title$/) != -1) {
          var subjects = m.getSubjects(null, value, true);
          res = res.concat(subjects);
        }
      }
    }
  }
  //private items microdata refers to
  if(micro && micro.items) {
    for(var i = 0; i < micro.items.length; i++) {
      var item = micro.items[i];
      var subject = item.id ? item.id : (item.properties["url"] ? item.properties["url"] : null);
      var type = item.type;
      var props = item.properties;
      
      for(var prop in props) {
        var values = props[prop];
        for(var j = 0; j < values.length; j++) {
          var value = values[j];
          
          if(m.projections[value]) {//search with subject
            res.push(value);
          }
          if(prop.search(/#?name$/) != -1
              || prop.search(/#?title$/) != -1) {
            var subjects = m.getSubjects(null, value, true);
            res = res.concat(subjects);
          }
        }
      }
    }
  }
  //TODO : referred : find in triplestore
  /*for(var subject in m.projections) {
    
  }*/
  return res;
}
function generateInsertedHTML(m, v, subjects) {
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
    var $summary = Viewer.getSubjectHTML(m, m.projections[subjects[i]], "referred_cell", true);
    $summaries.append($("<tr class='spider-summary'>").append($summary));
    
    var detail = v.getSummaryHTML(subjects[i]);
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
      if(request.action == "extracted") {
        if(!sender.tab || !sender.tab.id) {
          return;
        }
        //reset icon
        Viewer.changeIcon(sender.tab.id, false);
        //init
        var results = {};
        if(request.rdfa) {
          console.log("bg received RDFa");
          //sendResponse({farewell: "goodbye: " + res});
          results.rdfa = request.rdfa;
        }
        if(request.micro) {
          console.log("bg received microdata");
          //sendResponse({farewell: "goodbye: " + res});
          results.micro = request.micro;
        }
        if((request.rdfa && Manager.hasKey(request.rdfa)) ||
            (request.micro && request.micro.items.length)) {
          //notify the site has annotation
          Viewer.changeIcon(sender.tab.id, true);
        }
        results.expires = expires[request.url];
        results.onSelectionChanged = onSelectionChanged;
        bg_res[request.url] = results;
        countVisitNumber(request.url);
        
        //auto save the items based on visit number
        var visit = Options.get_visit();
        var m = new Manager(sender.tab);
        m.renew();
        if(visit && getVisitNumber(request.url) >= visit * 3) {
          console.log("save by frequent visit");
          m.save();
        }
        
        //feedback related items to content script
        var subjects = getRelatedSubjects(m, request.rdfa, request.micro);
        subjects = Manager.trimDuplicate(subjects);
        
        var v = new Viewer(m, sender.tab);
        var html = generateInsertedHTML(m, v, subjects);
        var time = Options.get_time();
        sendResponse({html: html, time: time});
      }
      //auto save for long stay at same site
      else if(request.action == "long-stay") {
        console.log("save by long stay");
        var m = new Manager(sender.tab);
        m.renew();
        m.save();
      }
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
function cleanOldItems() {
  var m = new Manager(null);
  m.renew();
 
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
  if(Options.is_remove()) {
    cleanOldItems();
  }
});